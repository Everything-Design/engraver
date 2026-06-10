// Pure engraving compute: image pixels + structure params -> stroke geometry.
// Runs inside the Web Worker. Deterministic (seeded RNG) so re-renders are stable.

import { StructureParams } from '../types'
import { computeField } from './field'
import { placeStreamlines, Stroke } from './streamlines'

export interface EngraveInput {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface EngraveResult {
  w: number
  h: number
  strokes: Stroke[]
}

// Deterministic PRNG (mulberry32) so the anti-lattice jitter is stable across renders.
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function engrave(img: EngraveInput, s: StructureParams): EngraveResult {
  const w = img.width
  const h = img.height
  const data = img.data
  const n = w * h

  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255
  }

  // Tone transfer -> banded darkness. ROUND (not ceil/floor): light areas round DOWN to
  // band 0 = bare paper, so highlights carry zero lines and only mid/shadow tones hatch.
  // This is what gives the reference its tonal contrast instead of an all-over flood.
  const levels = Math.max(2, Math.round(s.tonalLevels))
  const span = Math.max(0.001, s.highlightClip - s.blackPoint)
  const darkness = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const g = Math.pow(lum[i], s.gamma)
    let t = (g - s.blackPoint) / span
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const dCont = 1 - t
    const band = Math.round(dCont * levels) // 0..levels; 0 => bare paper
    darkness[i] = band / levels
  }

  const radius = Math.round(2 + s.flowSmoothness * 8)
  const field = computeField(lum, w, h, radius)

  const baseAngle = (s.baseAngle * Math.PI) / 180
  const rng = makeRng(0x9e3779b9)

  // Primary hatch set.
  const primary = placeStreamlines(field, darkness, {
    basePitch: s.basePitch,
    spacingRatio: s.spacingRatio,
    strokeWidth: s.strokeWidth,
    swell: s.swell,
    latticeJitter: s.latticeJitter,
    flowWeight: s.flowWeight,
    baseAngle,
    edgeBreakDist: s.edgeBreakDist,
    angleOffset: 0,
    darknessGate: 0,
    rng,
  })

  let strokes: Stroke[] = primary

  // Cross-hatch set: a second pass rotated 90°, gated to darker tones only.
  if (s.crossHatch > 0.01) {
    const gate = 0.82 - 0.5 * s.crossHatch // crossHatch 1 -> gate 0.32 (more area)
    const cross = placeStreamlines(field, darkness, {
      basePitch: s.basePitch * 1.1,
      spacingRatio: s.spacingRatio,
      strokeWidth: s.strokeWidth * 0.95,
      swell: s.swell,
      latticeJitter: s.latticeJitter,
      flowWeight: s.flowWeight,
      baseAngle,
      edgeBreakDist: s.edgeBreakDist,
      angleOffset: Math.PI / 2,
      darknessGate: gate,
      rng,
    })
    strokes = primary.concat(cross)
  }

  // Contour set: bold outlines traced ALONG strong edges (drawn last, on top).
  if (s.edgeStrength > 0.01) {
    const edgeThresh = 0.42 - 0.27 * s.edgeStrength // higher edgeStrength -> lower thresh -> more contour
    const contour = placeStreamlines(field, darkness, {
      basePitch: Math.max(2, s.basePitch * 0.8),
      spacingRatio: s.spacingRatio,
      strokeWidth: s.strokeWidth,
      swell: 0,
      latticeJitter: 0,
      flowWeight: 1,
      baseAngle,
      edgeBreakDist: s.edgeBreakDist,
      angleOffset: 0,
      darknessGate: 0,
      rng,
      mode: 'contour',
      edgeThresh,
      contourWidth: s.strokeWidth * (1.1 + 0.7 * s.edgeStrength),
    })
    strokes = strokes.concat(contour)
  }

  return { w, h, strokes }
}
