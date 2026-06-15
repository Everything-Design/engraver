// Style presets — full Structure param sets per subject.

import { StructureParams, StyleParams } from '../types'

export type StyleKey = 'portrait' | 'architectural' | 'sculptural'

export interface Preset {
  key: StyleKey
  label: string
  hint: string
  structure: StructureParams
  style: StyleParams
}

export const PRESETS: Record<StyleKey, Preset> = {
  portrait: {
    key: 'portrait',
    label: 'Portrait',
    hint: 'Faces — contour hatch + cross-hatch mesh, lines wrap features',
    structure: {
      tonalLevels: 9, blackPoint: 0.07, highlightClip: 0.93, gamma: 1.05,
      basePitch: 5, spacingRatio: 6, strokeWidth: 0.8, swell: 0.6, latticeJitter: 0.4,
      flowWeight: 0.85, baseAngle: 0, planarRegions: false, flowSmoothness: 0.7,
      crossHatch: 0.8, stippleTransition: 0.7, edgeStrength: 0.45, edgeBreakDist: 1.5,
    },
    style: { ink: '#5b4636', paper: '#f7f4ee' },
  },
  architectural: {
    key: 'architectural',
    label: 'Architectural',
    hint: 'Buildings & geometry — planar diagonal hatch, strong edges',
    structure: {
      // More tonal bands + finer pitch carry detail; heavier cross-hatch builds shadow;
      // stronger edges keep the subject outline legible even under planar snapping.
      tonalLevels: 7, blackPoint: 0.06, highlightClip: 0.93, gamma: 1.0,
      basePitch: 5, spacingRatio: 5, strokeWidth: 0.85, swell: 0.35, latticeJitter: 0.3,
      flowWeight: 0.55, baseAngle: 45, planarRegions: true, flowSmoothness: 0.5,
      crossHatch: 0.45, stippleTransition: 0.3, edgeStrength: 0.72, edgeBreakDist: 1.0,
    },
    style: { ink: '#27513f', paper: '#eef4ee' },
  },
  sculptural: {
    key: 'sculptural',
    label: 'Sculptural',
    hint: 'Objects & forms — flowing contour lines over the whole surface',
    structure: {
      // 4 levels rendered everything blocky; lift to 7 for gradation, add cross-hatch for
      // shadow detail, finer pitch + thinner stroke for crisper line work.
      tonalLevels: 7, blackPoint: 0.06, highlightClip: 0.95, gamma: 1.0,
      basePitch: 5, spacingRatio: 5, strokeWidth: 0.8, swell: 0.6, latticeJitter: 0.25,
      flowWeight: 0.9, baseAngle: 0, planarRegions: false, flowSmoothness: 0.85,
      crossHatch: 0.32, stippleTransition: 0.4, edgeStrength: 0.62, edgeBreakDist: 2.5,
    },
    style: { ink: '#a65b50', paper: '#f6ece8' },
  },
}
