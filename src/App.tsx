import { useCallback, useEffect, useRef, useState } from 'react'
import { Controls } from './components/Controls'
import { PRESETS, StyleKey } from './engine/presets'
import { analyze } from './engine/analyze'
import { mapToParams } from './engine/autoParams'
import { drawEngraving, PackedStrokes } from './render/strokeCanvas'
import { DEFAULT_PARAMS, EngraveParams, StructureParams } from './types'

const FIELD_LONG = 760 // working resolution for field + streamlines
const EXPORT_LONG = 2000

// Downscale an image to a working-resolution ImageData (long edge = FIELD_LONG).
function toFieldImageData(image: ImageBitmap, longSide: number) {
  const srcW = image.width, srcH = image.height
  const scale = Math.min(1, longSide / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  // Composite onto white so transparent PNG cut-outs read as bare paper, not black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(image, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

// Build a vector SVG from packed strokes (mean width per stroke, field-resolution viewBox).
function buildSVG(packed: PackedStrokes, ink: string, paper: string): string {
  const { w, h, coords, widths, lengths } = packed
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${paper}"/>`,
    `<g stroke="${ink}" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
  ]
  let vi = 0
  for (let si = 0; si < lengths.length; si++) {
    const n = lengths[si]
    if (n < 2) { vi += n; continue }
    let wsum = 0
    for (let i = 0; i < n; i++) wsum += widths[vi + i]
    const lw = Math.max(0.2, wsum / n)
    let d = `M${coords[vi * 2].toFixed(1)} ${coords[vi * 2 + 1].toFixed(1)}`
    for (let i = 1; i < n; i++) d += `L${coords[(vi + i) * 2].toFixed(1)} ${coords[(vi + i) * 2 + 1].toFixed(1)}`
    out.push(`<path d="${d}" stroke-width="${lw.toFixed(2)}"/>`)
    vi += n
  }
  out.push('</g></svg>')
  return out.join('')
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const sourceRef = useRef<ImageData | null>(null)
  const packedRef = useRef<PackedStrokes | null>(null)
  const reqIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [params, setParams] = useState<EngraveParams>(DEFAULT_PARAMS)
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [style, setStyle] = useState<StyleKey | null>(null)
  const [autoStyle, setAutoStyle] = useState<StyleKey | null>(null)
  const [format, setFormat] = useState<'image/png' | 'image/jpeg' | 'image/svg+xml'>('image/png')
  const [hasImage, setHasImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])

  // Draw the current packed strokes into the canvas, fit to the stage.
  const render = useCallback(() => {
    const packed = packedRef.current
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!packed || !canvas || !stage) return
    const dpr = window.devicePixelRatio || 1
    const pad = 64
    const aspect = packed.w / packed.h
    let dispW = stage.clientWidth - pad
    let dispH = dispW / aspect
    if (dispH > stage.clientHeight - pad) {
      dispH = stage.clientHeight - pad
      dispW = dispH * aspect
    }
    canvas.style.width = `${Math.floor(dispW)}px`
    canvas.style.height = `${Math.floor(dispH)}px`
    canvas.width = Math.floor(dispW * dpr)
    canvas.height = Math.floor(dispH * dpr)
    drawEngraving(canvas, packed, paramsRef.current.style)
  }, [])

  // Init worker.
  useEffect(() => {
    const worker = new Worker(new URL('./engine/engrave.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.id !== reqIdRef.current) return // stale
      packedRef.current = { w: msg.w, h: msg.h, coords: msg.coords, widths: msg.widths, lengths: msg.lengths }
      setBusy(false)
      render()
    }
    workerRef.current = worker
    return () => worker.terminate()
  }, [render])

  // Recompute streamlines for a given structure.
  const recompute = useCallback((structure: StructureParams) => {
    const src = sourceRef.current
    const worker = workerRef.current
    if (!src || !worker) return
    setBusy(true)
    const id = ++reqIdRef.current
    worker.postMessage({
      id,
      img: { data: src.data, width: src.width, height: src.height },
      params: structure,
    })
  }, [])

  const scheduleRecompute = useCallback((structure: StructureParams) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => recompute(structure), 200)
  }, [recompute])

  // Structure change -> recompute; style change -> just redraw (instant re-tint).
  const setStructure = useCallback((patch: Partial<StructureParams>) => {
    setParams((prev) => {
      const next = { ...prev, structure: { ...prev.structure, ...patch } }
      scheduleRecompute(next.structure)
      return next
    })
  }, [scheduleRecompute])

  const setStyleParams = useCallback((patch: Partial<EngraveParams['style']>) => {
    setParams((prev) => {
      const next = { ...prev, style: { ...prev.style, ...patch } }
      requestAnimationFrame(render)
      return next
    })
  }, [render])

  const applyStyle = useCallback((key: StyleKey) => {
    const p = PRESETS[key]
    setStyle(key)
    setParams(() => {
      const next = { structure: { ...p.structure }, style: { ...p.style } }
      scheduleRecompute(next.structure)
      return next
    })
  }, [scheduleRecompute])

  // Auto-tune: measure the image and derive every dial + a suggested duotone, then recompute.
  const processBitmap = useCallback((bitmap: ImageBitmap) => {
    const auto = mapToParams(analyze(bitmap))
    sourceRef.current = toFieldImageData(bitmap, FIELD_LONG)
    setAutoStyle(null)
    setStyle(null)
    setNotes(['Auto-tuned for this image', ...auto.notes])
    setHasImage(true)
    setParams({ structure: auto.structure, style: auto.style })
    scheduleRecompute(auto.structure)
  }, [scheduleRecompute])

  const handleUpload = useCallback(async (file: File) => {
    setError(null)
    setBusy(true)
    try {
      processBitmap(await createImageBitmap(file))
    } catch (e) {
      setError('Could not load that image. Try a PNG or JPG.')
      setBusy(false)
      console.error(e)
    }
  }, [processBitmap])

  // Auto-load a bundled default image on first open so the page isn't blank.
  const defaultLoadedRef = useRef(false)
  useEffect(() => {
    if (defaultLoadedRef.current) return
    defaultLoadedRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('default.png')
        if (!res.ok || cancelled) return
        const bitmap = await createImageBitmap(await res.blob())
        if (cancelled) return
        setBusy(true)
        processBitmap(bitmap)
      } catch {
        /* no default available — page stays on the upload prompt */
      }
    })()
    return () => { cancelled = true }
  }, [processBitmap])

  // Export: re-render the streamlines at high resolution to a fresh canvas.
  const handleExport = useCallback(async () => {
    const packed = packedRef.current
    if (!packed) return
    const { ink, paper } = paramsRef.current.style

    if (format === 'image/svg+xml') {
      const svg = buildSVG(packed, ink, paper)
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'engraving.svg')
      return
    }

    const aspect = packed.w / packed.h
    const longSide = EXPORT_LONG
    const w = aspect >= 1 ? longSide : Math.round(longSide * aspect)
    const h = aspect >= 1 ? Math.round(longSide / aspect) : longSide
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    drawEngraving(cv, packed, paramsRef.current.style)
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, format, 0.95))
    if (!blob) return
    downloadBlob(blob, format === 'image/png' ? 'engraving.png' : 'engraving.jpg')
  }, [format])

  // Save / load the full parameter set as JSON (a reusable "base preset").
  const handleSavePreset = useCallback(() => {
    downloadBlob(
      new Blob([JSON.stringify(paramsRef.current, null, 2)], { type: 'application/json' }),
      'engraver-preset.json',
    )
  }, [])

  const handleLoadPreset = useCallback(async (file: File) => {
    try {
      const obj = JSON.parse(await file.text())
      if (obj && obj.structure && obj.style) {
        setStyle(null)
        setParams(obj)
        scheduleRecompute(obj.structure)
      } else {
        setError('That JSON is not an Engraver preset.')
      }
    } catch {
      setError('Could not read that preset file.')
    }
  }, [scheduleRecompute])

  useEffect(() => {
    const onResize = () => render()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [render])

  return (
    <div className="app">
      <Controls
        params={params}
        onStructure={setStructure}
        onStyleChange={setStyleParams}
        onUpload={handleUpload}
        onExport={handleExport}
        hasImage={hasImage}
        style={style}
        autoStyle={autoStyle}
        onSelectStyle={applyStyle}
        format={format}
        onFormatChange={setFormat}
        onSavePreset={handleSavePreset}
        onLoadPreset={handleLoadPreset}
        busy={busy}
      />
      <main className="stage" ref={stageRef}>
        {error && <div className="stage__error">{error}</div>}
        {hasImage && notes.length > 0 && (
          <div style={{
            position: 'absolute', top: 14, left: 14, right: 14, fontSize: 11,
            color: '#5b6470', background: 'rgba(255,255,255,0.82)', padding: '7px 11px',
            borderRadius: 9, lineHeight: 1.45, pointerEvents: 'none',
          }}>
            {notes.join('  ·  ')}
          </div>
        )}
        {!hasImage && !error && (
          <div className="stage__empty">
            <p>Upload an image to begin.</p>
            <span>Processed entirely in your browser — nothing is uploaded to a server.</span>
          </div>
        )}
        <canvas ref={canvasRef} className="stage__canvas" style={{ display: hasImage ? 'block' : 'none' }} />
        {busy && <div className="stage__busy">engraving…</div>}
      </main>
    </div>
  )
}
