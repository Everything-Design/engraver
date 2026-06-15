import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { Controls } from './components/Controls'
import { PRESETS, StyleKey } from './engine/presets'
import { analyze } from './engine/analyze'
import { mapToParams } from './engine/autoParams'
import { drawEngraving, PackedStrokes } from './render/strokeCanvas'
import {
  DEFAULT_PARAMS,
  EngraveParams,
  PRESET_VERSION,
  StructureParams,
  StyleParams,
  WorkerRequest,
  WorkerResponse,
} from './types'

const FIELD_LONG = 760 // working resolution for field + streamlines
const EXPORT_LONG = 2000
const COPY_LONG = 1600 // resolution for copy-to-clipboard
const MAX_FILE_BYTES = 40 * 1024 * 1024 // 40 MB upload guard (Q23)
const MAX_SOURCE_DIM = 12000 // reject absurd dimensions after decode (Q23)

// Allowed range per structure dial — mirrors the Controls sliders. Used to clamp/sanitize
// loaded presets (Q15) so a hand-edited or stale JSON can't push the engine out of bounds.
const STRUCTURE_RANGES: Record<keyof StructureParams, [number, number]> = {
  tonalLevels: [3, 12],
  blackPoint: [0, 0.4],
  highlightClip: [0.6, 1],
  gamma: [0.5, 2],
  basePitch: [2, 16],
  spacingRatio: [2, 10],
  strokeWidth: [0.4, 2],
  swell: [0, 1],
  latticeJitter: [0, 1],
  flowWeight: [0, 1],
  baseAngle: [0, 180],
  planarRegions: [0, 1],
  flowSmoothness: [0, 1],
  crossHatch: [0, 1],
  stippleTransition: [0, 1],
  edgeStrength: [0, 1],
  edgeBreakDist: [0.5, 4],
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

// Coerce arbitrary JSON into a safe EngraveParams: clamp numbers, fill missing from defaults,
// validate colours. Returns null only when the object isn't recognisably a preset (Q15).
function sanitizeParams(obj: unknown): EngraveParams | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (!o.structure || typeof o.structure !== 'object') return null
  const src = o.structure as Record<string, unknown>
  const structure = { ...DEFAULT_PARAMS.structure }
  for (const k of Object.keys(STRUCTURE_RANGES) as (keyof StructureParams)[]) {
    const [lo, hi] = STRUCTURE_RANGES[k]
    if (k === 'planarRegions') {
      structure.planarRegions = Boolean(src[k] ?? structure.planarRegions)
      continue
    }
    const raw = src[k]
    const num = typeof raw === 'number' && Number.isFinite(raw) ? raw : (structure[k] as number)
    ;(structure[k] as number) = Math.min(hi, Math.max(lo, num))
  }
  structure.tonalLevels = Math.round(structure.tonalLevels)

  const st = (o.style ?? {}) as Record<string, unknown>
  const style: StyleParams = {
    ink: isHex(st.ink) ? st.ink : DEFAULT_PARAMS.style.ink,
    paper: isHex(st.paper) ? st.paper : DEFAULT_PARAMS.style.paper,
  }
  return { structure, style }
}

// Downscale an image to a working-resolution ImageData (long edge = FIELD_LONG).
function toFieldImageData(image: ImageBitmap, longSide: number): ImageData {
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

// Render packed strokes to a fresh canvas at a target long-edge resolution.
function renderToCanvas(packed: PackedStrokes, style: StyleParams, longSide: number): HTMLCanvasElement {
  const aspect = packed.w / packed.h
  const w = aspect >= 1 ? longSide : Math.round(longSide * aspect)
  const h = aspect >= 1 ? Math.round(longSide / aspect) : longSide
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  drawEngraving(cv, packed, style)
  return cv
}

// --- Share link (Q19): pack the params into the URL hash, unicode-safe. ---
function encodeParams(p: EngraveParams): string {
  return btoa(encodeURIComponent(JSON.stringify({ ...p, version: PRESET_VERSION })))
}
function decodeHashParams(): EngraveParams | null {
  const m = location.hash.match(/[#&]p=([^&]+)/)
  if (!m) return null
  try {
    return sanitizeParams(JSON.parse(decodeURIComponent(atob(m[1]))))
  } catch {
    return null
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const compareRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const sourceBitmapRef = useRef<ImageBitmap | null>(null) // retained for re-derive + compare
  const workerNeedsSourceRef = useRef(false) // current worker hasn't received this image yet
  const packedRef = useRef<PackedStrokes | null>(null)
  const reqIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSizeRef = useRef({ w: 0, h: 0 }) // backing-store guard (Q7)

  const [params, setParams] = useState<EngraveParams>(DEFAULT_PARAMS)
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [style, setStyle] = useState<StyleKey | null>(null)
  const [format, setFormat] = useState<'image/png' | 'image/jpeg' | 'image/svg+xml'>('image/png')
  const [hasImage, setHasImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [notesOpen, setNotesOpen] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  // --- Undo/redo history (Q10) ---
  const autoParamsRef = useRef<EngraveParams>(DEFAULT_PARAMS) // auto-tuned baseline for reset
  const historyRef = useRef<EngraveParams[]>([])
  const histIndexRef = useRef(-1)
  const histTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hist, setHist] = useState({ canUndo: false, canRedo: false })
  const syncHist = useCallback(() => {
    setHist({
      canUndo: histIndexRef.current > 0,
      canRedo: histIndexRef.current < historyRef.current.length - 1,
    })
  }, [])
  const pushHistory = useCallback((p: EngraveParams, reset = false) => {
    if (reset) {
      historyRef.current = [p]
      histIndexRef.current = 0
    } else {
      const stack = historyRef.current.slice(0, histIndexRef.current + 1)
      stack.push(p)
      if (stack.length > 60) stack.shift()
      historyRef.current = stack
      histIndexRef.current = stack.length - 1
    }
    syncHist()
  }, [syncHist])
  const scheduleHistory = useCallback((next: EngraveParams) => {
    if (histTimerRef.current) clearTimeout(histTimerRef.current)
    histTimerRef.current = setTimeout(() => pushHistory(next), 450)
  }, [pushHistory])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200)
  }, [])

  // Q7: split sizing from drawing. resize() reallocates the backing store ONLY when the
  // fitted size actually changed (realloc clears + is costly); redraw() paints cached geometry.
  const resize = useCallback((): boolean => {
    const packed = packedRef.current
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!packed || !canvas || !stage) return false
    const dpr = window.devicePixelRatio || 1
    const pad = 64
    const aspect = packed.w / packed.h
    let dispW = stage.clientWidth - pad
    let dispH = dispW / aspect
    if (dispH > stage.clientHeight - pad) {
      dispH = stage.clientHeight - pad
      dispW = dispH * aspect
    }
    const bw = Math.max(1, Math.floor(dispW * dpr))
    const bh = Math.max(1, Math.floor(dispH * dpr))
    canvas.style.width = `${Math.floor(dispW)}px`
    canvas.style.height = `${Math.floor(dispH)}px`
    const compare = compareRef.current
    if (compare) {
      compare.style.width = `${Math.floor(dispW)}px`
      compare.style.height = `${Math.floor(dispH)}px`
    }
    if (bw === lastSizeRef.current.w && bh === lastSizeRef.current.h) return false
    canvas.width = bw
    canvas.height = bh
    if (compare) { compare.width = bw; compare.height = bh }
    lastSizeRef.current = { w: bw, h: bh }
    return true
  }, [])

  const redraw = useCallback(() => {
    const packed = packedRef.current
    const canvas = canvasRef.current
    if (!packed || !canvas) return
    drawEngraving(canvas, packed, paramsRef.current.style)
  }, [])

  const render = useCallback(() => {
    resize()
    redraw()
  }, [resize, redraw])

  // Init worker (Q1: surface engine failures instead of hanging "engraving…" forever).
  useEffect(() => {
    const worker = new Worker(new URL('./engine/engrave.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.id !== reqIdRef.current) return // stale
      if (msg.kind === 'error') {
        setBusy(false)
        setError(msg.message || 'The engraving engine reported an error.')
        return
      }
      packedRef.current = { w: msg.w, h: msg.h, coords: msg.coords, widths: msg.widths, lengths: msg.lengths }
      console.debug(
        `[engraver] field ${msg.timings.field.toFixed(1)}ms · place ${msg.timings.place.toFixed(1)}ms · total ${msg.timings.total.toFixed(1)}ms`,
      )
      setBusy(false)
      setError(null)
      render()
    }
    worker.onerror = (e) => {
      setBusy(false)
      setError('The engraving engine crashed. Try a smaller image, or reload the page.')
      console.error('worker.onerror', e)
    }
    worker.onmessageerror = () => {
      setBusy(false)
      setError('The engraving engine sent data this browser could not read.')
    }
    workerRef.current = worker
    workerNeedsSourceRef.current = true // a fresh worker has no cached source
    return () => worker.terminate()
  }, [render])

  // Recompute streamlines. Sends the source ONCE per worker (transferred), then params-only
  // messages reuse the worker's cached source + field (Q17). The source is re-derived from the
  // retained bitmap so worker restarts (and React StrictMode remounts) stay correct.
  const recompute = useCallback((structure: StructureParams) => {
    const worker = workerRef.current
    const bitmap = sourceBitmapRef.current
    if (!worker || !bitmap) return
    setBusy(true)
    setError(null)
    const id = ++reqIdRef.current
    if (workerNeedsSourceRef.current) {
      const src = toFieldImageData(bitmap, FIELD_LONG)
      workerNeedsSourceRef.current = false
      const msg: WorkerRequest = {
        kind: 'source',
        id,
        img: { data: src.data, width: src.width, height: src.height },
        params: structure,
      }
      worker.postMessage(msg, [src.data.buffer])
    } else {
      const msg: WorkerRequest = { kind: 'params', id, params: structure }
      worker.postMessage(msg)
    }
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
      scheduleHistory(next)
      return next
    })
  }, [scheduleRecompute, scheduleHistory])

  const setStyleParams = useCallback((patch: Partial<StyleParams>) => {
    setParams((prev) => {
      const next = { ...prev, style: { ...prev.style, ...patch } }
      requestAnimationFrame(redraw)
      scheduleHistory(next)
      return next
    })
  }, [redraw, scheduleHistory])

  const applyStyle = useCallback((key: StyleKey) => {
    const p = PRESETS[key]
    setStyle(key)
    const next = { structure: { ...p.structure }, style: { ...p.style } }
    setParams(next)
    pushHistory(next)
    scheduleRecompute(next.structure)
  }, [scheduleRecompute, pushHistory])

  // Undo/redo restore a snapshot and recompute (Q10).
  const applyHistory = useCallback((idx: number) => {
    const p = historyRef.current[idx]
    if (!p) return
    histIndexRef.current = idx
    syncHist()
    setStyle(null)
    setParams(p)
    scheduleRecompute(p.structure)
  }, [scheduleRecompute, syncHist])
  const undo = useCallback(() => applyHistory(histIndexRef.current - 1), [applyHistory])
  const redo = useCallback(() => applyHistory(histIndexRef.current + 1), [applyHistory])
  const resetAuto = useCallback(() => {
    const p = autoParamsRef.current
    setStyle(null)
    setParams(p)
    pushHistory(p)
    scheduleRecompute(p.structure)
  }, [pushHistory, scheduleRecompute])

  // Auto-tune: measure the image and derive every dial + a suggested duotone, then recompute.
  const pendingHashRef = useRef<EngraveParams | null>(decodeHashParams())
  const processBitmap = useCallback((bitmap: ImageBitmap) => {
    const auto = mapToParams(analyze(bitmap))
    sourceBitmapRef.current = bitmap
    workerNeedsSourceRef.current = true
    autoParamsRef.current = { structure: auto.structure, style: auto.style }
    setStyle(null)
    setNotes(['Auto-tuned for this image', ...auto.notes])
    setNotesOpen(true)
    setHasImage(true)
    // A shared link's params win for the first image only.
    const initial = pendingHashRef.current ?? { structure: auto.structure, style: auto.style }
    pendingHashRef.current = null
    setParams(initial)
    pushHistory(initial, true)
    scheduleRecompute(initial.structure)
  }, [scheduleRecompute, pushHistory])

  const loadFile = useCallback(async (file: File) => {
    setError(null)
    setBusy(true)
    // Q23: branch the common failure modes before decoding.
    if (file.size > MAX_FILE_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(0)} MB — too large. Try one under ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
      setBusy(false)
      return
    }
    const isHeic = /heic|heif/i.test(file.type) || /\.he(ic|if)$/i.test(file.name)
    try {
      const bitmap = await createImageBitmap(file)
      if (bitmap.width > MAX_SOURCE_DIM || bitmap.height > MAX_SOURCE_DIM) {
        setError(`That image is ${bitmap.width}×${bitmap.height}px — too large to process. Resize it first.`)
        setBusy(false)
        return
      }
      processBitmap(bitmap)
    } catch (e) {
      if (isHeic) {
        setError('HEIC/HEIF images aren’t supported by this browser. Export as JPG or PNG and try again.')
      } else {
        setError('Could not read that image — it may be corrupt or an unsupported format. Try a PNG or JPG.')
      }
      setBusy(false)
      console.error(e)
    }
  }, [processBitmap])

  // Auto-load a bundled default image on first open so the page isn't blank. The `active`
  // flag is per-effect-invocation (not a preserved ref), so React StrictMode's mount/remount
  // cancels only the dead instance — the live one still loads. A skipped load just leaves the
  // upload prompt.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('default.png')
        if (!res.ok || !active) return
        const bitmap = await createImageBitmap(await res.blob())
        if (!active) return
        setBusy(true)
        processBitmap(bitmap)
      } catch {
        /* no default available — page stays on the upload prompt */
      }
    })()
    return () => { active = false }
  }, [processBitmap])

  // Export: re-render the streamlines at high resolution to a fresh canvas.
  const handleExport = useCallback(async () => {
    const packed = packedRef.current
    if (!packed) return
    const { ink, paper } = paramsRef.current.style
    try {
      if (format === 'image/svg+xml') {
        downloadBlob(new Blob([buildSVG(packed, ink, paper)], { type: 'image/svg+xml' }), 'engraving.svg')
        return
      }
      const cv = renderToCanvas(packed, paramsRef.current.style, EXPORT_LONG)
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, format, 0.95))
      if (!blob) { setError('Export failed — could not encode the image.'); return }
      downloadBlob(blob, format === 'image/png' ? 'engraving.png' : 'engraving.jpg')
    } catch (e) {
      setError('Export failed.')
      console.error(e)
    }
  }, [format])

  // Copy the engraving to the clipboard as a PNG (Q19).
  const handleCopyImage = useCallback(async () => {
    const packed = packedRef.current
    if (!packed) return
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      setError('Copying images isn’t supported in this browser. Use Export instead.')
      return
    }
    try {
      const cv = renderToCanvas(packed, paramsRef.current.style, COPY_LONG)
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'))
      if (!blob) return
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      showToast('Image copied to clipboard')
    } catch (e) {
      setError('Could not copy the image.')
      console.error(e)
    }
  }, [showToast])

  // Copy a shareable URL whose hash carries the current params (Q19).
  const handleShareLink = useCallback(async () => {
    const hash = `#p=${encodeParams(paramsRef.current)}`
    history.replaceState(null, '', hash)
    const url = location.href
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        showToast('Share link copied')
      } else {
        showToast('Link is in the address bar')
      }
    } catch {
      showToast('Link is in the address bar')
    }
  }, [showToast])

  // Save / load the full parameter set as JSON (a reusable "base preset").
  const handleSavePreset = useCallback(() => {
    downloadBlob(
      new Blob([JSON.stringify({ ...paramsRef.current, version: PRESET_VERSION }, null, 2)], { type: 'application/json' }),
      'engraver-preset.json',
    )
  }, [])

  const handleLoadPreset = useCallback(async (file: File) => {
    try {
      const obj = JSON.parse(await file.text())
      const clean = sanitizeParams(obj)
      if (!clean) {
        setError('That JSON is not an Engraver preset.')
        return
      }
      if (typeof obj.version === 'number' && obj.version !== PRESET_VERSION) {
        showToast(`Preset is v${obj.version} (app is v${PRESET_VERSION}) — values clamped to fit.`)
      }
      setStyle(null)
      setParams(clean)
      pushHistory(clean)
      scheduleRecompute(clean.structure)
    } catch {
      setError('Could not read that preset file.')
    }
  }, [scheduleRecompute, pushHistory, showToast])

  // rAF-throttled resize (Q7).
  useEffect(() => {
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(render)
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf) }
  }, [render])

  // Clipboard paste upload (Q13).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) { e.preventDefault(); loadFile(file) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  // Keyboard undo/redo (Q10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Hold-to-compare with the source (Q11): paint the source bitmap into the overlay canvas.
  const [comparing, setComparing] = useState(false)
  const startCompare = useCallback(() => {
    const bitmap = sourceBitmapRef.current
    const compare = compareRef.current
    if (!bitmap || !compare) return
    const ctx = compare.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, compare.width, compare.height)
    ctx.drawImage(bitmap, 0, 0, compare.width, compare.height)
    setComparing(true)
  }, [])
  const endCompare = useCallback(() => setComparing(false), [])

  // Whole-stage drag-and-drop (Q13).
  const [dragging, setDragging] = useState(false)
  const onDragOver = useCallback((e: ReactDragEvent) => { e.preventDefault(); setDragging(true) }, [])
  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (e.currentTarget === e.target) setDragging(false)
  }, [])
  const onDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }, [loadFile])

  return (
    <div className="app">
      <Controls
        params={params}
        onStructure={setStructure}
        onStyleChange={setStyleParams}
        onUpload={loadFile}
        onExport={handleExport}
        hasImage={hasImage}
        style={style}
        onSelectStyle={applyStyle}
        format={format}
        onFormatChange={setFormat}
        onSavePreset={handleSavePreset}
        onLoadPreset={handleLoadPreset}
        onUndo={undo}
        onRedo={redo}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
        onResetAuto={resetAuto}
        onCopyImage={handleCopyImage}
        onShareLink={handleShareLink}
        busy={busy}
      />
      <main
        className={'stage' + (dragging ? ' stage--drag' : '')}
        ref={stageRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {error && <div className="stage__error" role="alert">{error}</div>}
        {hasImage && notes.length > 0 && notesOpen && (
          <aside className="stage__notes" aria-label="Auto-tune notes">
            <button className="stage__notes-close" onClick={() => setNotesOpen(false)} aria-label="Dismiss notes">×</button>
            {notes.join('  ·  ')}
          </aside>
        )}
        {!hasImage && !error && (
          <div className="stage__empty">
            <p>Upload, drag in, or paste an image to begin.</p>
            <span>Processed entirely in your browser — nothing is uploaded to a server.</span>
          </div>
        )}
        <div className="stage__canvas-wrap" style={{ display: hasImage ? 'block' : 'none' }}>
          <canvas
            ref={canvasRef}
            className="stage__canvas"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startCompare() }}
            onPointerUp={endCompare}
            onPointerCancel={endCompare}
            onPointerLeave={endCompare}
          />
          <canvas
            ref={compareRef}
            className="stage__compare"
            style={{ display: comparing ? 'block' : 'none' }}
            aria-hidden="true"
          />
        </div>
        {hasImage && (
          <div className="stage__hint">Hold the image to compare with the source</div>
        )}
        {busy && <div className="stage__busy" role="status">engraving…</div>}
        {toast && <div className="stage__toast" role="status">{toast}</div>}
        {dragging && <div className="stage__drop">Drop image to engrave</div>}
      </main>
    </div>
  )
}
