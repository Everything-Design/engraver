import { CSSProperties, useState } from 'react'
import { PRESETS, StyleKey } from '../engine/presets'
import { DUOTONES, EngraveParams, StructureParams } from '../types'

interface Props {
  params: EngraveParams
  onStructure: (patch: Partial<StructureParams>) => void
  onStyleChange: (patch: Partial<EngraveParams['style']>) => void
  onUpload: (file: File) => void
  onExport: () => void
  hasImage: boolean
  style: StyleKey | null
  onSelectStyle: (key: StyleKey) => void
  format: 'image/png' | 'image/jpeg' | 'image/svg+xml'
  onFormatChange: (f: 'image/png' | 'image/jpeg' | 'image/svg+xml') => void
  onSavePreset: () => void
  onLoadPreset: (file: File) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onResetAuto: () => void
  onCopyImage: () => void
  onShareLink: () => void
  busy: boolean
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  hint: string
  display?: string
  onChange: (v: number) => void
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <label className="control" title={props.hint}>
      <span className="control__row">
        <span className="control__label">{props.label}</span>
        <span className="control__val">{props.display ?? props.value.toFixed(2)}</span>
      </span>
      <input
        className="slider"
        style={{ '--fill': `${pct}%` } as CSSProperties}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={`${props.label}. ${props.hint}`}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

export function Controls(p: Props) {
  const s = p.params.structure
  const set = p.onStructure
  const [advanced, setAdvanced] = useState(false)

  return (
    <aside className="panel">
      <header className="brand">
        <span className="brand__mark">ENGRAVER</span>
        <span className="brand__sub">ETCHED<br />ILLUSTRATION<br />STUDIO</span>
      </header>

      <label className="upload">
        {p.hasImage ? 'Replace image' : 'Upload image'}
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && p.onUpload(e.target.files[0])} />
      </label>

      {/* Undo / redo / reset (Q10) */}
      <div className="toolbar" role="group" aria-label="History">
        <button className="tool" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (⌘Z)" aria-label="Undo">↶ Undo</button>
        <button className="tool" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">↷ Redo</button>
        <button className="tool" onClick={p.onResetAuto} disabled={!p.hasImage} title="Reset every dial to the auto-tuned values for this image">Reset to auto</button>
      </div>

      {/* Simple / Advanced disclosure (Q14) */}
      <div className="seg" role="group" aria-label="Detail level">
        <button className={'seg__btn' + (!advanced ? ' seg__btn--active' : '')} onClick={() => setAdvanced(false)} aria-pressed={!advanced}>Simple</button>
        <button className={'seg__btn' + (advanced ? ' seg__btn--active' : '')} onClick={() => setAdvanced(true)} aria-pressed={advanced}>Advanced</button>
      </div>

      <section className="card">
        <h2 className="card__title">Style</h2>
        <div className="styles">
          {(Object.keys(PRESETS) as StyleKey[]).map((k) => (
            <button
              key={k}
              className={'style' + (p.style === k ? ' style--active' : '')}
              onClick={() => p.onSelectStyle(k)}
              title={PRESETS[k].hint}
              aria-pressed={p.style === k}
            >
              {PRESETS[k].label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Tone</h2>
        <Slider label="Tonal levels" value={s.tonalLevels} min={3} max={12} step={1} display={`${s.tonalLevels}`} hint="Number of posterization bands before lines are placed. Fewer = bolder, more graphic; more = smoother gradation." onChange={(v) => set({ tonalLevels: v })} />
        <Slider label="Gamma" value={s.gamma} min={0.5} max={2} step={0.01} hint="Midtone bias. Below 1 darkens midtones (denser hatch); above 1 lifts them." onChange={(v) => set({ gamma: v })} />
        {advanced && <>
          <Slider label="Black point" value={s.blackPoint} min={0} max={0.4} step={0.01} hint="Luminance that maps to full ink. Raise to deepen shadows." onChange={(v) => set({ blackPoint: v })} />
          <Slider label="Highlight clip" value={s.highlightClip} min={0.6} max={1} step={0.01} hint="Luminance above which the paper stays bare. Lower to bring detail into highlights." onChange={(v) => set({ highlightClip: v })} />
        </>}
      </section>

      <section className="card">
        <h2 className="card__title">Line geometry</h2>
        <Slider label="Base pitch" value={s.basePitch} min={2} max={16} step={0.5} display={`${s.basePitch}px`} hint="Mid-tone spacing between hatch lines, in working-resolution pixels. Smaller = finer, denser." onChange={(v) => set({ basePitch: v })} />
        <Slider label="Stroke width" value={s.strokeWidth} min={0.4} max={2} step={0.05} hint="Base ink width of each line." onChange={(v) => set({ strokeWidth: v })} />
        {advanced && <>
          <Slider label="Spacing ratio" value={s.spacingRatio} min={2} max={10} step={0.1} hint="Darkest-to-lightest spacing ratio. Higher = stronger tonal contrast between dense and sparse areas." onChange={(v) => set({ spacingRatio: v })} />
          <Slider label="Swell" value={s.swell} min={0} max={1} step={0.01} hint="How much line width varies with tone — the burin swell that reads as hand-cut." onChange={(v) => set({ swell: v })} />
          <Slider label="Lattice jitter" value={s.latticeJitter} min={0} max={1} step={0.01} hint="Randomizes spacing/phase to break up a mechanical lattice look." onChange={(v) => set({ latticeJitter: v })} />
        </>}
      </section>

      {advanced && <>
        <section className="card">
          <h2 className="card__title">Direction</h2>
          <Slider label="Flow weight" value={s.flowWeight} min={0} max={1} step={0.01} hint="Blend between a fixed hatch angle (0) and lines that follow image flow/form (1)." onChange={(v) => set({ flowWeight: v })} />
          <Slider label="Base angle" value={s.baseAngle} min={0} max={180} step={1} display={`${Math.round(s.baseAngle)}°`} hint="The fixed-angle component, in degrees." onChange={(v) => set({ baseAngle: v })} />
          <Slider label="Flow smoothness" value={s.flowSmoothness} min={0} max={1} step={0.01} hint="Smoothing radius of the orientation field. Higher = steadier, calmer line direction." onChange={(v) => set({ flowSmoothness: v })} />
        </section>

        <section className="card">
          <h2 className="card__title">Layering</h2>
          <Slider label="Cross-hatch" value={s.crossHatch} min={0} max={1} step={0.01} hint="Strength and reach of the perpendicular cross-hatch layer in darker tones." onChange={(v) => set({ crossHatch: v })} />
          <Slider label="Edge break dist" value={s.edgeBreakDist} min={0.5} max={4} step={0.1} display={`${s.edgeBreakDist.toFixed(1)}px`} hint="How far from a detected edge a hatch line terminates. (Takes full effect with coherent edges — coming in M2.)" onChange={(v) => set({ edgeBreakDist: v })} />
        </section>
      </>}

      <section className="card">
        <h2 className="card__title">Duotone</h2>
        <div className="swatches">
          {DUOTONES.map((d) => {
            const active = d.ink === p.params.style.ink && d.paper === p.params.style.paper
            return (
              <button
                key={d.name}
                className={'swatch' + (active ? ' swatch--active' : '')}
                title={d.name}
                aria-label={d.name}
                aria-pressed={active}
                style={{ background: d.paper, borderColor: d.ink }}
                onClick={() => p.onStyleChange({ ink: d.ink, paper: d.paper })}
              >
                <span style={{ background: d.ink }} />
              </button>
            )
          })}
        </div>
        <div className="pickers">
          <label className="control control--inline">
            <span className="control__label">Ink</span>
            <input type="color" aria-label="Ink color" value={p.params.style.ink} onChange={(e) => p.onStyleChange({ ink: e.target.value })} />
          </label>
          <label className="control control--inline">
            <span className="control__label">Paper</span>
            <input type="color" aria-label="Paper color" value={p.params.style.paper} onChange={(e) => p.onStyleChange({ paper: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Export</h2>
        <div className="seg" role="group" aria-label="Export format">
          <button className={'seg__btn' + (p.format === 'image/png' ? ' seg__btn--active' : '')} onClick={() => p.onFormatChange('image/png')} aria-pressed={p.format === 'image/png'}>PNG</button>
          <button className={'seg__btn' + (p.format === 'image/jpeg' ? ' seg__btn--active' : '')} onClick={() => p.onFormatChange('image/jpeg')} aria-pressed={p.format === 'image/jpeg'}>JPG</button>
          <button className={'seg__btn' + (p.format === 'image/svg+xml' ? ' seg__btn--active' : '')} onClick={() => p.onFormatChange('image/svg+xml')} aria-pressed={p.format === 'image/svg+xml'}>SVG</button>
        </div>
        <button className="export" disabled={!p.hasImage || p.busy} onClick={p.onExport}>
          {p.busy ? 'Working…' : `Export ${p.format === 'image/png' ? 'PNG' : p.format === 'image/jpeg' ? 'JPG' : 'SVG'}`}
        </button>
        <div className="seg" style={{ marginTop: 8 }}>
          <button className="seg__btn" onClick={p.onCopyImage} disabled={!p.hasImage} title="Copy the engraving to the clipboard as a PNG">Copy image</button>
          <button className="seg__btn" onClick={p.onShareLink} disabled={!p.hasImage} title="Copy a link that restores these settings">Share link</button>
        </div>
        <div className="seg" style={{ marginTop: 8 }}>
          <button className="seg__btn" onClick={p.onSavePreset}>Save preset</button>
          <label className="seg__btn" style={{ cursor: 'pointer', textAlign: 'center' }}>
            Load preset
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && p.onLoadPreset(e.target.files[0])} />
          </label>
        </div>
      </section>
    </aside>
  )
}
