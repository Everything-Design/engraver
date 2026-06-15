// Orientation + edge field for the streamline engraver.
//
// Produces a smooth DIRECTOR field (line orientation) via the structure tensor, plus a
// coherence map (how strongly oriented a region is) and an edge map (for streamline
// termination / contour). Director orientation is stored as a unit tangent vector; the
// tensor is box-blurred so the field is smooth and streamlines integrate cleanly.
//
// Phase-0 fix vs the old code: orientation lives in the smoothed TENSOR (sin2θ/cos2θ space),
// so there is no head/tail sign cancellation, and the field is computed at full working
// resolution rather than 360px.

export interface Field {
  w: number
  h: number
  dirx: Float32Array // unit tangent x (line direction)
  diry: Float32Array // unit tangent y
  coh: Float32Array // coherence 0..1
  edge: Float32Array // edge strength 0..1 (normalized gradient magnitude)
}

// Edge-Tangent-Flow refinement (Q5). A few iterations sharpen the director field into
// coherent flow: each tangent is pulled toward its better-oriented, higher-coherence
// neighbours. Tangents are 180°-ambiguous, so neighbour contributions are sign-aligned
// (φ) before accumulation. Cheap (small radius) and noticeably steadier hatch direction.
function etfSmooth(
  dirx: Float32Array,
  diry: Float32Array,
  coh: Float32Array,
  w: number,
  h: number,
  radius: number,
  iters: number,
) {
  const nx = new Float32Array(dirx.length)
  const ny = new Float32Array(diry.length)
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const cx = dirx[i], cy = diry[i]
        let ax = 0, ay = 0
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const j = yy * w + xx
            const dot = cx * dirx[j] + cy * diry[j]
            const phi = dot >= 0 ? 1 : -1 // sign-align (direction-agnostic)
            // magnitude weight = neighbour coherence; directional weight = |alignment|
            const wgt = coh[j] * Math.abs(dot)
            ax += phi * wgt * dirx[j]
            ay += phi * wgt * diry[j]
          }
        }
        const len = Math.hypot(ax, ay)
        if (len > 1e-6) { nx[i] = ax / len; ny[i] = ay / len }
        else { nx[i] = cx; ny[i] = cy }
      }
    }
    dirx.set(nx)
    diry.set(ny)
  }
}

export function computeField(
  lum: Float32Array,
  w: number,
  h: number,
  smoothRadius: number,
  etfIters = 2,
): Field {
  const idx = (x: number, y: number) => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y
    return cy * w + cx
  }

  const Jxx = new Float32Array(w * h)
  const Jxy = new Float32Array(w * h)
  const Jyy = new Float32Array(w * h)
  const edge = new Float32Array(w * h)
  let maxMag = 1e-6

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = lum[idx(x - 1, y - 1)], tc = lum[idx(x, y - 1)], tr = lum[idx(x + 1, y - 1)]
      const ml = lum[idx(x - 1, y)], mr = lum[idx(x + 1, y)]
      const bl = lum[idx(x - 1, y + 1)], bc = lum[idx(x, y + 1)], br = lum[idx(x + 1, y + 1)]
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl)
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr)
      const i = y * w + x
      Jxx[i] = gx * gx
      Jxy[i] = gx * gy
      Jyy[i] = gy * gy
      const m = Math.hypot(gx, gy)
      edge[i] = m
      if (m > maxMag) maxMag = m
    }
  }
  for (let i = 0; i < w * h; i++) edge[i] /= maxMag

  const blur = (src: Float32Array, r: number): Float32Array => {
    const tmp = new Float32Array(w * h)
    const out = new Float32Array(w * h)
    const norm = 1 / (2 * r + 1)
    for (let y = 0; y < h; y++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += src[idx(k, y)]
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc * norm
        acc += src[idx(x + r + 1, y)] - src[idx(x - r, y)]
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += tmp[idx(x, k)]
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc * norm
        acc += tmp[idx(x, y + r + 1)] - tmp[idx(x, y - r)]
      }
    }
    return out
  }

  const r = Math.max(1, smoothRadius)
  const Sxx = blur(Jxx, r), Sxy = blur(Jxy, r), Syy = blur(Jyy, r)

  const dirx = new Float32Array(w * h)
  const diry = new Float32Array(w * h)
  const coh = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const xx = Sxx[i], xy = Sxy[i], yy = Syy[i]
    // Dominant gradient orientation; tangent = +90°.
    const theta = 0.5 * Math.atan2(2 * xy, xx - yy)
    const tang = theta + Math.PI / 2
    dirx[i] = Math.cos(tang)
    diry[i] = Math.sin(tang)
    const trace = xx + yy
    const disc = Math.sqrt((xx - yy) * (xx - yy) + 4 * xy * xy)
    coh[i] = trace > 1e-6 ? Math.min(1, disc / trace) : 0
  }

  if (etfIters > 0) etfSmooth(dirx, diry, coh, w, h, 2, etfIters)

  const edgeS = blur(edge, 1)
  return { w, h, dirx, diry, coh, edge: edgeS }
}
