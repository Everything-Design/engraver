// Canvas-2D stroke renderer. Paints the worker's packed streamline geometry as ink lines
// on tinted paper. Each stroke is a variable-width RIBBON with tapered ends — the burin
// swell/taper that reads as hand-cut engraving rather than uniform machine rule. Re-tinting
// (ink/paper) is just a redraw of cached geometry — instant.

import { StyleParams } from '../types'

export interface PackedStrokes {
  w: number // field resolution the coords are in
  h: number
  coords: Float32Array // x,y interleaved
  widths: Float32Array // per-vertex width (field-res px)
  lengths: Uint32Array // vertex count per stroke
}

export function drawEngraving(
  canvas: HTMLCanvasElement,
  packed: PackedStrokes,
  style: StyleParams,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  const sx = W / packed.w
  const sy = H / packed.h
  const ws = (sx + sy) * 0.5

  ctx.fillStyle = style.paper
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = style.ink

  const { coords, widths, lengths } = packed
  const px: number[] = []
  const py: number[] = []
  const hw: number[] = []

  let vi = 0
  for (let si = 0; si < lengths.length; si++) {
    const n = lengths[si]
    if (n < 2) { vi += n; continue }

    px.length = py.length = hw.length = n
    const taper = Math.max(1, Math.floor(n * 0.2))
    for (let i = 0; i < n; i++) {
      px[i] = coords[(vi + i) * 2] * sx
      py[i] = coords[(vi + i) * 2 + 1] * sy
      // Taper both ends toward a point (engraved line-ends).
      let f = 1
      if (i < taper) f = (i + 1) / (taper + 1)
      else if (i >= n - taper) f = (n - i) / (taper + 1)
      hw[i] = Math.max(0.12, widths[vi + i] * ws * 0.5 * f)
    }

    // Ribbon polygon: left side forward, right side back.
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const ia = i === 0 ? 0 : i - 1
      const ib = i === n - 1 ? n - 1 : i + 1
      let tx = px[ib] - px[ia]
      let ty = py[ib] - py[ia]
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl; ty /= tl
      const x = px[i] + (-ty) * hw[i]
      const y = py[i] + tx * hw[i]
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    for (let i = n - 1; i >= 0; i--) {
      const ia = i === 0 ? 0 : i - 1
      const ib = i === n - 1 ? n - 1 : i + 1
      let tx = px[ib] - px[ia]
      let ty = py[ib] - py[ia]
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl; ty /= tl
      ctx.lineTo(px[i] - (-ty) * hw[i], py[i] - tx * hw[i])
    }
    ctx.closePath()
    ctx.fill()
    vi += n
  }
}
