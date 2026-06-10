// Canvas-2D stroke renderer. Paints the worker's packed streamline geometry as ink lines
// on tinted paper. Re-tinting (ink/paper) is just a redraw of cached geometry — instant.

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
  ctx.strokeStyle = style.ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const { coords, widths, lengths } = packed
  let vi = 0 // vertex index
  for (let si = 0; si < lengths.length; si++) {
    const n = lengths[si]
    if (n < 2) { vi += n; continue }
    // Mean width for the stroke (tone is ~constant along a short engraved cut).
    let wsum = 0
    for (let i = 0; i < n; i++) wsum += widths[vi + i]
    const lw = Math.max(0.25, (wsum / n) * ws)

    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(coords[vi * 2] * sx, coords[vi * 2 + 1] * sy)
    for (let i = 1; i < n; i++) {
      ctx.lineTo(coords[(vi + i) * 2] * sx, coords[(vi + i) * 2 + 1] * sy)
    }
    ctx.stroke()
    vi += n
  }
}
