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

  // Auto-levels: stretch tonal range; background-aware highlight clip.
  const blackPoint = clamp(s.p2 - 0.02, 0, 0.35)
  const highlightClip =
    s.bgKind === 'light-uniform'
      ? clamp(Math.min(s.bgLum - 0.04, s.p98), 0.6, 1)
      : clamp(s.p98 + 0.02, 0.6, 1)
  const gamma = clamp(0.6 + (0.5 - s.key) * 1.2, 0.5, 1.8)
  const tonalLevels = Math.round(lerp(5, 10, smoothness))

  const planarRegions = s.axisRatio > 0.5 && s.skinRatio < 0.08
  const isPortrait = s.skinRatio > 0.12

  const structure: StructureParams = {
    tonalLevels,
    blackPoint,
    highlightClip,
    gamma,
    basePitch: lerp(8, 4, s.busyness),
    spacingRatio: lerp(4, 7, s.dynRange),
    strokeWidth: s.key < 0.4 ? 0.95 : 0.85,
    swell: planarRegions ? 0.3 : isPortrait ? 0.6 : 0.55,
    latticeJitter: lerp(0.25, 0.45, smoothness),
    flowWeight: planarRegions ? 0.5 : lerp(0.7, 0.92, 1 - s.axisRatio),
    baseAngle: planarRegions ? clamp(s.dominantAngleDeg, 0, 180) : isPortrait ? 0 : 35,
    planarRegions,
    flowSmoothness: lerp(0.4, 0.85, 1 - s.axisRatio),
    crossHatch: clamp(s.shadowFraction * 1.6, 0.1, 0.85),
    stippleTransition: clamp(s.midSmoothFraction, 0.2, 0.7),
    edgeStrength: clamp(0.62 - s.busyness, 0.2, 0.7),
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
