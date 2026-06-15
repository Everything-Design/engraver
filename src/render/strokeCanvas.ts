// Canvas-2D stroke renderer. Paints the worker's packed streamline geometry as ink lines
// on tinted paper. Each stroke is a variable-width RIBBON — the burin swell/taper that reads
// as hand-cut engraving rather than uniform machine rule. Re-tinting (ink/paper) is just a
// redraw of cached geometry — instant.
//
// Q6: ribbons are accumulated into ONE Path2D per tint bucket and committed with a single
// fill() per bucket, instead of a beginPath()/fill() per stroke. With today's single ink that
// collapses tens of thousands of fills into one; the bucket map is the seam B3 (multi-tone)
// will extend to carry per-stroke chroma.

import { StyleParams } from '../types'

export interface PackedStrokes {
  w: number // field resolution the coords are in
  h: number
  coords: Float32Array // x,y interleaved
  widths: Float32Array // per-vertex width (field-res px)
  lengths: Uint32Array // vertex count per stroke
}

// Q3: cap the end-taper at a few vertices. The per-vertex swell widths (set in the engine)
// are honoured through the body of every line; only the extreme tips soften. The old code
// tapered 20% of *every* stroke, which flattened the ends of long interior hatch lines —
// misrepresenting tone. Short stipple flicks (small n) still taper most of their length.
const MAX_TAPER = 3

function appendRibbon(
  path: Path2D,
  coords: Float32Array,
  widths: Float32Array,
  vi: number,
  n: number,
  sx: number,
  sy: number,
  ws: number,
) {
  const px: number[] = new Array(n)
  const py: number[] = new Array(n)
  const hw: number[] = new Array(n)
  const taper = Math.max(1, Math.min(MAX_TAPER, Math.floor(n * 0.2)))
  for (let i = 0; i < n; i++) {
    px[i] = coords[(vi + i) * 2] * sx
    py[i] = coords[(vi + i) * 2 + 1] * sy
    let f = 1
    if (i < taper) f = (i + 1) / (taper + 1)
    else if (i >= n - taper) f = (n - i) / (taper + 1)
    hw[i] = Math.max(0.12, widths[vi + i] * ws * 0.5 * f)
  }

  // Ribbon polygon: left side forward, right side back.
  for (let i = 0; i < n; i++) {
    const ia = i === 0 ? 0 : i - 1
    const ib = i === n - 1 ? n - 1 : i + 1
    let tx = px[ib] - px[ia]
    let ty = py[ib] - py[ia]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl; ty /= tl
    const x = px[i] + (-ty) * hw[i]
    const y = py[i] + tx * hw[i]
    if (i === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  }
  for (let i = n - 1; i >= 0; i--) {
    const ia = i === 0 ? 0 : i - 1
    const ib = i === n - 1 ? n - 1 : i + 1
    let tx = px[ib] - px[ia]
    let ty = py[ib] - py[ia]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl; ty /= tl
    path.lineTo(px[i] - (-ty) * hw[i], py[i] - tx * hw[i])
  }
  path.closePath()
}

export function drawEngraving(
  canvas: HTMLCanvasElement,
  packed: PackedStrokes,
  style: StyleParams,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const t0 =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  const W = canvas.width
  const H = canvas.height
  const sx = W / packed.w
  const sy = H / packed.h
  const ws = (sx + sy) * 0.5

  ctx.fillStyle = style.paper
  ctx.fillRect(0, 0, W, H)

  const { coords, widths, lengths } = packed

  // One Path2D per tint bucket. Single ink for now → one bucket, one fill().
  const buckets = new Map<string, Path2D>()
  const tintOf = (_si: number) => style.ink

  let vi = 0
  for (let si = 0; si < lengths.length; si++) {
    const n = lengths[si]
    if (n < 2) { vi += n; continue }
    const tint = tintOf(si)
    let path = buckets.get(tint)
    if (!path) { path = new Path2D(); buckets.set(tint, path) }
    appendRibbon(path, coords, widths, vi, n, sx, sy, ws)
    vi += n
  }

  for (const [tint, path] of buckets) {
    ctx.fillStyle = tint
    ctx.fill(path)
  }

  const t1 =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
  // Q24: measured, not asserted. Visible in the console for perf work.
  console.debug(`[engraver] draw ${lengths.length} strokes in ${(t1 - t0).toFixed(1)}ms`)
}
