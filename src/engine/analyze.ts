// Image analysis for auto-tuning (see AUTOTUNE.md). One cheap pass over a downscaled,
// white-composited copy produces statistics that mapToParams() turns into engraving dials.

export interface ImageStats {
  p2: number
  p50: number
  p98: number
  mean: number
  std: number
  dynRange: number
  key: number // = mean (low: dark/low-key, high: bright/high-key)
  bgLum: number
  bgVar: number
  bgKind: 'light-uniform' | 'dark-uniform' | 'busy'
  subjectCoverage: number
  busyness: number
  axisRatio: number
  skinRatio: number
  sat: number
  hue: number // 0..360
  warm: boolean
  shadowFraction: number
  midSmoothFraction: number
  dominantAngleDeg: number
}

export function analyze(image: ImageBitmap, maxDim = 180): ImageStats {
  const srcW = image.width, srcH = image.height
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(image, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const n = w * h

  const lum = new Float32Array(n)
  const hist = new Float32Array(256)
  let mean = 0, skin = 0, satSum = 0, hueCos = 0, hueSin = 0, satCount = 0, shadow = 0
  for (let i = 0; i < n; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    lum[i] = l
    mean += l
    hist[Math.min(255, (l * 255) | 0)]++
    if (l < 0.3) shadow++
    if (r > 95 && g > 40 && b > 20 && r > g && g > b && r - Math.min(g, b) > 15) skin++
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const sat = mx > 0 ? (mx - mn) / mx : 0
    satSum += sat
    if (sat > 0.15 && mx > mn) {
      let hue: number
      if (mx === r) hue = ((g - b) / (mx - mn)) % 6
      else if (mx === g) hue = (b - r) / (mx - mn) + 2
      else hue = (r - g) / (mx - mn) + 4
      hue *= 60; if (hue < 0) hue += 360
      const rad = (hue * Math.PI) / 180
      hueCos += Math.cos(rad) * sat
      hueSin += Math.sin(rad) * sat
      satCount++
    }
  }
  mean /= n

  const pct = (target: number) => {
    let acc = 0; const t = target * n
    for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= t) return b / 255 }
    return 1
  }
  const p2 = pct(0.02), p50 = pct(0.5), p98 = pct(0.98)
  let varSum = 0
  for (let i = 0; i < n; i++) { const d = lum[i] - mean; varSum += d * d }
  const std = Math.sqrt(varSum / n)
  const sat = satSum / n
  let hue = 0
  if (satCount > 0) { hue = (Math.atan2(hueSin, hueCos) * 180) / Math.PI; if (hue < 0) hue += 360 }

  // Border ring -> background tone + uniformity.
  const bw = Math.max(1, Math.round(Math.min(w, h) * 0.08))
  const onBorder = (x: number, y: number) => x < bw || x >= w - bw || y < bw || y >= h - bw
  let bSum = 0, bN = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (onBorder(x, y)) { bSum += lum[y * w + x]; bN++ }
  const bgLum = bN ? bSum / bN : 1
  let bVar = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (onBorder(x, y)) { const d = lum[y * w + x] - bgLum; bVar += d * d }
  bVar = bN ? bVar / bN : 0

  let subj = 0
  for (let i = 0; i < n; i++) if (Math.abs(lum[i] - bgLum) > 0.12) subj++

  // Sobel pass -> busyness, axis ratio, dominant angle, smooth mid-tones.
  const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  let strong = 0, axis = 0, total = 0, midSmooth = 0, midCount = 0
  const angHist = new Float32Array(18)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = at(x + 1, y) - at(x - 1, y)
    const gy = at(x, y + 1) - at(x, y - 1)
    const m = Math.hypot(gx, gy)
    total++
    const l = lum[y * w + x]
    if (l > 0.35 && l < 0.75) { midCount++; if (m < 0.06) midSmooth++ }
    if (m > 0.18) {
      strong++
      let a = Math.atan2(gy, gx); if (a < 0) a += Math.PI
      const af = Math.min(a, Math.PI - a)
      if (af < 0.26 || Math.abs(af - Math.PI / 2) < 0.26) axis++
      angHist[Math.min(17, (a / Math.PI) * 18 | 0)] += m
    }
  }
  const busyness = strong / total
  const axisRatio = strong > 0 ? axis / strong : 0
  let peak = 0, pa = 0
  for (let b = 0; b < 18; b++) if (angHist[b] > pa) { pa = angHist[b]; peak = b }
  const dominantAngleDeg = ((peak + 0.5) / 18) * 180
  const midSmoothFraction = midCount ? midSmooth / midCount : 0

  let bgKind: ImageStats['bgKind'] = 'busy'
  if (bVar < 0.02) {
    if (bgLum > 0.72) bgKind = 'light-uniform'
    else if (bgLum < 0.32) bgKind = 'dark-uniform'
  }

  return {
    p2, p50, p98, mean, std, dynRange: p98 - p2, key: mean,
    bgLum, bgVar: bVar, bgKind, subjectCoverage: subj / n,
    busyness, axisRatio, skinRatio: skin / n, sat, hue, warm: hue < 60 || hue > 300,
    shadowFraction: shadow / n, midSmoothFraction, dominantAngleDeg,
  }
}
