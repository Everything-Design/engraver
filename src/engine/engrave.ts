// Pure engraving compute: image pixels + structure params -> stroke geometry.
// Runs inside the Web Worker. Deterministic (seeded RNG) so re-renders are stable.

import { StructureParams } from '../types'
import { computeField, Field } from './field'
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

// Circular distance on [0,π) (orientations are direction-agnostic).
function angDist(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}

// Region-planar orientation (Building): find the few dominant hatch angles and snap every
// pixel's direction to its nearest one — so flat planes hatch at a locally-constant angle
// rather than one global angle, and the angle changes between planes.
function snapFieldToPlanar(field: Field, k: number): Field {
  const { w, h, dirx, diry, coh, edge } = field
  const BINS = 36
  const hist = new Float32Array(BINS)
  for (let i = 0; i < w * h; i++) {
    let a = Math.atan2(diry[i], dirx[i])
    if (a < 0) a += Math.PI
    const b = Math.min(BINS - 1, (a / Math.PI) * BINS | 0)
    hist[b] += coh[i]
  }
  const order = Array.from({ length: BINS }, (_, i) => i).sort((x, y) => hist[y] - hist[x])
  const doms: number[] = []
  for (const b of order) {
    const ang = ((b + 0.5) / BINS) * Math.PI
    if (doms.every((d) => angDist(d, ang) > 0.35)) doms.push(ang)
    if (doms.length >= k) break
  }
  if (doms.length === 0) doms.push(0)

  const ndx = new Float32Array(w * h)
  const ndy = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    let a = Math.atan2(diry[i], dirx[i])
    if (a < 0) a += Math.PI
    let best = doms[0], bd = 1e9
    for (const d of doms) { const dd = angDist(d, a); if (dd < bd) { bd = dd; best = d } }
    ndx[i] = Math.cos(best)
    ndy[i] = Math.sin(best)
  }
  return { w, h, dirx: ndx, diry: ndy, coh, edge }
}

// Stipple: in the lightest active tonal band, break continuous lines into short tapered
// flicks (engraved stipple) instead of solid hatch.
function stippleStrokes(strokes: Stroke[], darkness: Float32Array, w: number, h: number, levels: number, amount: number): Stroke[] {
  if (amount <= 0.01) return strokes
  const lightMax = 1.5 / levels // only the lightest non-zero band
  const flickLen = 8 - 5 * amount
  const gapLen = 1.5 + 4 * amount
  const sampleD = (x: number, y: number) => {
    let cx = x | 0, cy = y | 0
    if (cx < 0) cx = 0; else if (cx >= w) cx = w - 1
    if (cy < 0) cy = 0; else if (cy >= h) cy = h - 1
    return darkness[cy * w + cx]
  }
  const out: Stroke[] = []
  for (const st of strokes) {
    const n = st.x.length
    let md = 0
    for (let i = 0; i < n; i++) md += sampleD(st.x[i], st.y[i])
    md /= n
    if (md > lightMax) { out.push(st); continue }

    let acc = 0
    let on = true
    let cur: number[] = []
    const flush = () => {
      if (cur.length >= 4) {
        const m = cur.length / 2
        const xs = new Float32Array(m), ys = new Float32Array(m), ws = new Float32Array(m)
        for (let j = 0; j < m; j++) { xs[j] = cur[j * 2]; ys[j] = cur[j * 2 + 1]; ws[j] = st.w[0] }
        out.push({ x: xs, y: ys, w: ws })
      }
      cur = []
    }
    for (let i = 0; i < n; i++) {
      if (i > 0) acc += Math.hypot(st.x[i] - st.x[i - 1], st.y[i] - st.y[i - 1])
      if (on) {
        cur.push(st.x[i], st.y[i])
        if (acc >= flickLen) { flush(); on = false; acc = 0 }
      } else if (acc >= gapLen) {
        on = true; acc = 0; cur.push(st.x[i], st.y[i])
      }
    }
    flush()
  }
  return out
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

  // Tone transfer -> banded darkness. ROUND so light areas drop to band 0 = bare paper.
  const levels = Math.max(2, Math.round(s.tonalLevels))
  const span = Math.max(0.001, s.highlightClip - s.blackPoint)
  const darkness = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const g = Math.pow(lum[i], s.gamma)
    let t = (g - s.blackPoint) / span
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const band = Math.round((1 - t) * levels)
    darkness[i] = band / levels
  }

  const radius = Math.round(2 + s.flowSmoothness * 8)
  const field = computeField(lum, w, h, radius)

  // Region-planar snapping for the hatch passes (Building); contours still use the raw field.
  const hatchField = s.planarRegions ? snapFieldToPlanar(field, 4) : field
  const hatchFlow = s.planarRegions ? 1 : s.flowWeight

  const baseAngle = (s.baseAngle * Math.PI) / 180
  const rng = makeRng(0x9e3779b9)

  // Primary hatch set, then stipple its lightest band into flicks.
  let primary = placeStreamlines(hatchField, darkness, {
    basePitch: s.basePitch,
    spacingRatio: s.spacingRatio,
    strokeWidth: s.strokeWidth,
    swell: s.swell,
    latticeJitter: s.latticeJitter,
    flowWeight: hatchFlow,
    baseAngle,
    edgeBreakDist: s.edgeBreakDist,
    angleOffset: 0,
    darknessGate: 0,
    rng,
  })
  primary = stippleStrokes(primary, darkness, w, h, levels, s.stippleTransition)

  let strokes: Stroke[] = primary

  // Cross-hatch set: rotated 90°, gated to darker tones only.
  if (s.crossHatch > 0.01) {
    const gate = 0.82 - 0.5 * s.crossHatch
    const cross = placeStreamlines(hatchField, darkness, {
      basePitch: s.basePitch * 1.1,
      spacingRatio: s.spacingRatio,
      strokeWidth: s.strokeWidth * 0.95,
      swell: s.swell,
      latticeJitter: s.latticeJitter,
      flowWeight: hatchFlow,
      baseAngle,
      edgeBreakDist: s.edgeBreakDist,
      angleOffset: Math.PI / 2,
      darknessGate: gate,
      rng,
    })
    strokes = strokes.concat(cross)
  }

  // Contour set: bold outlines traced ALONG strong edges (drawn last, on top).
  if (s.edgeStrength > 0.01) {
    const edgeThresh = 0.52 - 0.2 * s.edgeStrength // higher = only strong silhouette edges
    const contour = placeStreamlines(field, darkness, {
      basePitch: Math.max(2.5, s.basePitch * 0.9),
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
      contourWidth: s.strokeWidth * (1.0 + 0.4 * s.edgeStrength),
    })
    strokes = strokes.concat(contour)
  }

  return { w, h, strokes }
}
