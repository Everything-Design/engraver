// Auto-tune mapping (see AUTOTUNE.md): ImageStats -> engraving Structure params + duotone.
// Deterministic, clamped, explainable rules — not ML.

import { DUOTONES, StructureParams, StyleParams } from '../types'
import { ImageStats } from './analyze'

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1)
const byName = (name: string): StyleParams => {
  const d = DUOTONES.find((x) => x.name === name) || DUOTONES[0]
  return { ink: d.ink, paper: d.paper }
}

export interface AutoResult {
  structure: StructureParams
  style: StyleParams
  notes: string[]
}

export function mapToParams(s: ImageStats): AutoResult {
  const notes: string[] = []
  const smoothness = 1 - clamp(s.busyness * 3, 0, 1)

  const planarRegions = s.axisRatio > 0.5 && s.skinRatio < 0.08
  const isPortrait = s.skinRatio > 0.12
  const subjKey = s.subjectMean // tone of the SUBJECT (ignores a bright/empty background)

  const blackPoint = clamp(s.p2 - 0.02, 0, 0.24)
  const highlightClip =
    s.bgKind === 'light-uniform'
      ? clamp(Math.min(s.bgLum - 0.05, s.p98), 0.6, 0.97)
      : clamp(s.p98, 0.6, 0.97)
  const gamma = clamp(0.88 + (subjKey - 0.5) * 0.8, 0.6, 1.4)
  // Many fine bands = smooth, subtle gradation on the face.
  const tonalLevels = isPortrait ? 12 : Math.round(lerp(7, 10, smoothness))

  const structure: StructureParams = {
    tonalLevels,
    blackPoint,
    highlightClip,
    gamma,
    // FINE + DENSE: tight spacing with THIN strokes = subtle refined hatch (not heavy lines).
    basePitch: isPortrait ? lerp(4, 3, s.busyness) : lerp(7, 5, s.busyness),
    spacingRatio: lerp(3, 5, s.dynRange),
    strokeWidth: subjKey < 0.4 ? 0.78 : 0.6,
    swell: 0.22,
    latticeJitter: lerp(0.18, 0.32, smoothness),
    flowWeight: planarRegions ? 0.5 : lerp(0.72, 0.92, 1 - s.axisRatio),
    baseAngle: planarRegions ? clamp(s.dominantAngleDeg, 0, 180) : isPortrait ? 0 : 35,
    planarRegions,
    flowSmoothness: lerp(0.5, 0.85, 1 - s.axisRatio),
    crossHatch: clamp(s.shadowFraction * (isPortrait ? 0.8 : 1.0), 0.1, isPortrait ? 0.4 : 0.6),
    stippleTransition: clamp(s.midSmoothFraction * 0.3, 0, 0.18),
    // Light, selective contours — subtle definition, not bold outlines.
    edgeStrength: isPortrait ? clamp(0.34 - s.busyness * 0.4, 0.16, 0.34) : clamp(0.5 - s.busyness, 0.18, 0.5),
    edgeBreakDist: 1.5,
  }

  // Duotone from dominant color / subject.
  let style: StyleParams
  if (isPortrait) style = byName('Sepia Brown')
  else if (s.sat < 0.12) style = s.key < 0.45 ? byName('Charcoal') : byName('Steel Grey')
  else if (s.warm) style = byName('Oxblood Rose')
  else if (s.hue >= 160 && s.hue <= 280) style = byName('Intaglio Blue')
  else if (s.hue > 80 && s.hue < 170) style = byName('Intaglio Green')
  else style = byName('Sepia Brown')

  if (s.bgKind === 'dark-uniform')
    notes.push('Dark background — engraves as a solid field; try a lighter source or raise Highlight clip.')
  if (s.bgKind === 'busy')
    notes.push('Busy background — subject isn’t isolated, so lines fill the whole frame.')
  if (s.dynRange < 0.35)
    notes.push('Low-contrast source — auto-levels applied; nudge Gamma/Black point for more punch.')

  return { structure, style, notes }
}
