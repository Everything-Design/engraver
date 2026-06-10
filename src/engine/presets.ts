// Style presets — full Structure param sets per subject, plus a lightweight auto-classifier.

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
      tonalLevels: 5, blackPoint: 0.06, highlightClip: 0.93, gamma: 1.0,
      basePitch: 6, spacingRatio: 5, strokeWidth: 0.9, swell: 0.3, latticeJitter: 0.3,
      flowWeight: 0.5, baseAngle: 45, planarRegions: true, flowSmoothness: 0.4,
      crossHatch: 0.25, stippleTransition: 0.2, edgeStrength: 0.6, edgeBreakDist: 1.0,
    },
    style: { ink: '#27513f', paper: '#eef4ee' },
  },
  sculptural: {
    key: 'sculptural',
    label: 'Sculptural',
    hint: 'Objects & forms — flowing contour lines over the whole surface',
    structure: {
      tonalLevels: 4, blackPoint: 0.06, highlightClip: 0.95, gamma: 1.0,
      basePitch: 6, spacingRatio: 4, strokeWidth: 0.9, swell: 0.7, latticeJitter: 0.25,
      flowWeight: 0.9, baseAngle: 0, planarRegions: false, flowSmoothness: 0.85,
      crossHatch: 0.1, stippleTransition: 0.4, edgeStrength: 0.7, edgeBreakDist: 2.5,
    },
    style: { ink: '#a65b50', paper: '#f6ece8' },
  },
}

// Heuristic classifier: skin -> portrait, axis-aligned edges -> architectural, else sculptural.
export function classifyImage(image: HTMLImageElement | ImageBitmap): StyleKey {
  const w = 128
  const srcW = (image as HTMLImageElement).naturalWidth ?? image.width
  const srcH = (image as HTMLImageElement).naturalHeight ?? image.height
  const h = Math.max(1, Math.round((w * srcH) / srcW))

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image as CanvasImageSource, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data

  const lum = new Float32Array(w * h)
  let skin = 0
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
    lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    if (r > 95 && g > 40 && b > 20 && r > g && g > b && r - Math.min(g, b) > 15) skin++
  }
  const skinRatio = skin / (w * h)

  const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  let strong = 0, axis = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = at(x + 1, y) - at(x - 1, y)
      const gy = at(x, y + 1) - at(x, y - 1)
      const m = Math.hypot(gx, gy)
      if (m < 0.18) continue
      strong++
      const ang = Math.abs(Math.atan2(gy, gx))
      const a = Math.min(ang, Math.PI - ang)
      if (a < 0.26 || Math.abs(a - Math.PI / 2) < 0.26) axis++
    }
  }
  const axisRatio = strong > 0 ? axis / strong : 0

  if (axisRatio > 0.55 && skinRatio < 0.08) return 'architectural'
  if (skinRatio > 0.12) return 'portrait'
  return 'sculptural'
}
