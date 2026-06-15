// Jobard–Lefer evenly-spaced streamline placement, tone-driven, edge-terminated, jittered.
//
// Tone becomes LINE SPACING (denser where darker); each line is a continuous integral curve
// of the orientation field, so the result describes the form natively. The proximity test
// excludes a streamline's OWN recent samples (by id + sample order) — otherwise every line
// would reject its own previous point and die instantly.
//
// CONTOUR mode (mode:'contour') reuses the same machinery to trace boundary outlines: it
// seeds on strong edges, follows the edge tangent (which the field already aligns with),
// does NOT break at edges, uses fixed spacing, and does not spawn parallel neighbours — so
// it lays a single bold line along each silhouette/feature boundary.

import { CancelledError } from '../types'
import { Field } from './field'

export interface Stroke {
  x: Float32Array
  y: Float32Array
  w: Float32Array
}

export interface PlaceParams {
  basePitch: number
  spacingRatio: number
  strokeWidth: number
  swell: number
  latticeJitter: number
  flowWeight: number
  baseAngle: number // radians
  edgeBreakDist: number
  angleOffset: number // radians (π/2 for cross-hatch)
  darknessGate: number
  rng: () => number
  mode?: 'tone' | 'contour'
  edgeThresh?: number // contour: edge strength to trace
  contourWidth?: number // contour: line width
  cancel?: () => boolean // polled during placement; throws CancelledError if true (Q18)
}

const H = 0.9 // integration step (px)
const D_TEST = 0.8 // reject closer than D_TEST * local separation
const MAX_STEPS = 2200
const INK_EPS = 0.02
const EDGE_BREAK = 0.5 // only strong silhouette edges break hatch (keeps lines continuous over soft features)

export function placeStreamlines(field: Field, darkness: Float32Array, p: PlaceParams): Stroke[] {
  const { w, h } = field
  const isContour = p.mode === 'contour'
  const edgeThresh = p.edgeThresh ?? 0.35
  const fixedX = Math.cos(p.baseAngle)
  const fixedY = Math.sin(p.baseAngle)
  const cosO = Math.cos(p.angleOffset)
  const sinO = Math.sin(p.angleOffset)

  const sampleIdx = (x: number, y: number) => {
    let cx = x | 0, cy = y | 0
    if (cx < 0) cx = 0; else if (cx >= w) cx = w - 1
    if (cy < 0) cy = 0; else if (cy >= h) cy = h - 1
    return cy * w + cx
  }
  const darknessAt = (x: number, y: number) => darkness[sampleIdx(x, y)]
  const edgeAt = (x: number, y: number) => field.edge[sampleIdx(x, y)]
  const sepAt = (x: number, y: number) =>
    isContour ? p.basePitch : p.basePitch * Math.pow(p.spacingRatio, -darknessAt(x, y))
  const inkable = (x: number, y: number) => {
    if (isContour) return edgeAt(x, y) > edgeThresh
    const d = darknessAt(x, y)
    return d > INK_EPS && d >= p.darknessGate
  }

  const dirAt = (x: number, y: number, ox: number, oy: number) => {
    const i = sampleIdx(x, y)
    const tx = field.dirx[i], ty = field.diry[i]
    const wgt = isContour ? 1 : p.flowWeight * field.coh[i]
    const bx = fixedX * (1 - wgt) + tx * wgt
    const by = fixedY * (1 - wgt) + ty * wgt
    const rx = bx * cosO - by * sinO
    const ry = bx * sinO + by * cosO
    let len = Math.hypot(rx, ry)
    if (len < 1e-6) len = 1
    let ux = rx / len, uy = ry / len
    if (ux * ox + uy * oy < 0) { ux = -ux; uy = -uy }
    return [ux, uy] as const
  }

  // Spatial hash. Each point carries its streamline id + sample order for self-exclusion.
  const cell = Math.max(1, p.basePitch)
  const gw = Math.ceil(w / cell)
  const gh = Math.ceil(h / cell)
  const grid: number[][] = new Array(gw * gh)
  const ptsX: number[] = []
  const ptsY: number[] = []
  const ptsId: number[] = []
  const ptsOrd: number[] = []
  const addPoint = (x: number, y: number, id: number, ord: number) => {
    const gi = (y / cell | 0) * gw + (x / cell | 0)
    let c = grid[gi]
    if (!c) { c = []; grid[gi] = c }
    c.push(ptsX.length)
    ptsX.push(x); ptsY.push(y); ptsId.push(id); ptsOrd.push(ord)
  }
  const tooClose = (x: number, y: number, minDist: number, id: number, ord: number, skip: number) => {
    const md2 = minDist * minDist
    const r = Math.ceil(minDist / cell)
    const gx = x / cell | 0
    const gy = y / cell | 0
    for (let j = gy - r; j <= gy + r; j++) {
      if (j < 0 || j >= gh) continue
      for (let i = gx - r; i <= gx + r; i++) {
        if (i < 0 || i >= gw) continue
        const c = grid[j * gw + i]
        if (!c) continue
        for (let k = 0; k < c.length; k++) {
          const id2 = c[k]
          if (ptsId[id2] === id && Math.abs(ptsOrd[id2] - ord) <= skip) continue
          const dx = ptsX[id2] - x
          const dy = ptsY[id2] - y
          if (dx * dx + dy * dy < md2) return true
        }
      }
    }
    return false
  }

  const seeds: number[] = []
  let nextId = 0

  const integrate = (sx: number, sy: number, sign: number, id: number, ord0: number, ordStep: number, includeStart: boolean): number[] => {
    const path: number[] = []
    let x = sx, y = sy
    const i0 = sampleIdx(x, y)
    let ox = field.dirx[i0] * sign
    let oy = field.diry[i0] * sign
    let ord = ord0
    let first = true
    for (let step = 0; step < MAX_STEPS; step++) {
      if ((step & 511) === 0 && p.cancel?.()) throw new CancelledError()
      if (x < 0 || y < 0 || x >= w || y >= h) break
      if (!inkable(x, y)) break
      if (!isContour && step > 1 && edgeAt(x, y) > EDGE_BREAK) break
      const sep = sepAt(x, y)
      const skip = Math.ceil((sep * 2) / H) + 4
      if (tooClose(x, y, sep * D_TEST, id, ord, skip)) break
      if (!(first && !includeStart)) {
        path.push(x, y)
        addPoint(x, y, id, ord)
        ord += ordStep
      }
      first = false
      const [k1x, k1y] = dirAt(x, y, ox, oy)
      const mx = x + k1x * H * 0.5
      const my = y + k1y * H * 0.5
      const [k2x, k2y] = dirAt(mx, my, k1x, k1y)
      x += k2x * H
      y += k2y * H
      ox = k2x; oy = k2y
    }
    return path
  }

  const strokes: Stroke[] = []
  const grow = (sx: number, sy: number) => {
    if (!inkable(sx, sy)) return
    if (tooClose(sx, sy, sepAt(sx, sy) * D_TEST, -1, 0, 0)) return
    const id = nextId++
    const fwd = integrate(sx, sy, 1, id, 0, 1, true)
    const bwd = integrate(sx, sy, -1, id, -1, -1, false)
    const n = bwd.length / 2 + fwd.length / 2
    if (n < 5) return
    const xs = new Float32Array(n)
    const ys = new Float32Array(n)
    const ws = new Float32Array(n)
    let o = 0
    for (let i = bwd.length - 2; i >= 0; i -= 2) { xs[o] = bwd[i]; ys[o] = bwd[i + 1]; o++ }
    for (let i = 0; i < fwd.length; i += 2) { xs[o] = fwd[i]; ys[o] = fwd[i + 1]; o++ }
    const cw = p.contourWidth ?? p.strokeWidth
    for (let i = 0; i < n; i++) {
      if (isContour) {
        ws[i] = cw
      } else {
        const d = darknessAt(xs[i], ys[i])
        ws[i] = Math.max(0.15, p.strokeWidth * (1 + p.swell * (d - 0.5)))
      }
    }
    strokes.push({ x: xs, y: ys, w: ws })

    if (isContour) return // contours don't spawn parallel neighbours
    // Spawn candidate seeds perpendicular to the line (jittered) for the next placements.
    for (let i = 0; i < n; i += 2) {
      const ax = xs[i], ay = ys[i]
      const ii = Math.min(n - 1, i + 1)
      let tx = xs[ii] - ax, ty = ys[ii] - ay
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl; ty /= tl
      const nx = -ty, ny = tx
      const sep = sepAt(ax, ay)
      const jitter = 1 + (p.rng() - 0.5) * 2 * p.latticeJitter
      const off = sep * jitter
      seeds.push(ax + nx * off, ay + ny * off)
      seeds.push(ax - nx * off, ay - ny * off)
    }
  }

  // Initial seeds: contour seeds on strong edges; tone seeds on a coarse darkness grid.
  const initial: Array<[number, number, number]> = []
  if (isContour) {
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const e = edgeAt(x, y)
        if (e > edgeThresh) initial.push([e, x, y])
      }
    }
  } else {
    const gstep = Math.max(2, Math.round(p.basePitch))
    for (let y = 0; y < h; y += gstep) {
      for (let x = 0; x < w; x += gstep) {
        if (inkable(x, y)) initial.push([darknessAt(x, y), x, y])
      }
    }
  }
  initial.sort((a, b) => b[0] - a[0])
  for (const s of initial) seeds.push(s[1], s[2])

  let head = 0
  let seedTick = 0
  while (head < seeds.length) {
    if ((seedTick++ & 1023) === 0 && p.cancel?.()) throw new CancelledError()
    const sx = seeds[head++]
    const sy = seeds[head++]
    grow(sx, sy)
    if (strokes.length > 80000) break
  }

  return strokes
}
