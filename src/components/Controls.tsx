import { CSSProperties } from 'react'
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
  autoStyle: StyleKey | null
  onSelectStyle: (key: StyleKey) => void
  format: 'image/png' | 'image/jpeg' | 'image/svg+xml'
  onFormatChange: (f: 'image/png' | 'image/jpeg' | 'image/svg+xml') => void
  busy: boolean
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display?: string
  onChange: (v: number) => void
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <label className="control">
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
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

export function Controls(p: Props) {
  const s = p.params.structure
  const set = p.onStructure

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

      <section className="card">
        <h2 className="card__title">Style</h2>
        <div className="styles">
          {(Object.keys(PRESETS) as StyleKey[]).map((k) => (
            <button
              key={k}
              className={'style' + (p.style === k ? ' style--active' : '')}
              onClick={() => p.onSelectStyle(k)}
              title={PRESETS[k].hint}
            >
              {PRESETS[k].label}
              {p.autoStyle === k && <span className="style__auto">auto</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Tone</h2>
        <Slider label="Tonal levels" value={s.tonalLevels} min={3} max={12} step={1} display={`${s.tonalLevels}`} onChange={(v) => set({ tonalLevels: v })} />
        <Slider label="Black point" value={s.blackPoint} min={0} max={0.4} step={0.01} onChange={(v) => set({ blackPoint: v })} />
        <Slider label="Highlight clip" value={s.highlightClip} min={0.6} max={1} step={0.01} onChange={(v) => set({ highlightClip: v })} />
        <Slider label="Gamma" value={s.gamma} min={0.5} max={2} step={0.01} onChange={(v) => set({ gamma: v })} />
      </section>

      <section className="card">
        <h2 className="card__title">Line geometry</h2>
        <Slider label="Base pitch" value={s.basePitch} min={2} max={16} step={0.5} display={`${s.basePitch}px`} onChange={(v) => set({ basePitch: v })} />
        <Slider label="Spacing ratio" value={s.spacingRatio} min={2} max={10} step={0.1} onChange={(v) => set({ spacingRatio: v })} />
        <Slider label="Stroke width" value={s.strokeWidth} min={0.4} max={2} step={0.05} onChange={(v) => set({ strokeWidth: v })} />
        <Slider label="Swell" value={s.swell} min={0} max={1} step={0.01} onChange={(v) => set({ swell: v })} />
        <Slider label="Lattice jitter" value={s.latticeJitter} min={0} max={1} step={0.01} onChange={(v) => set({ latticeJitter: v })} />
      </section>

      <section className="card">
        <h2 className="card__title">Direction</h2>
        <Slider label="Flow weight" value={s.flowWeight} min={0} max={1} step={0.01} onChange={(v) => set({ flowWeight: v })} />
        <Slider label="Base angle" value={s.baseAngle} min={0} max={180} step={1} display={`${Math.round(s.baseAngle)}°`} onChange={(v) => set({ baseAngle: v })} />
        <Slider label="Flow smoothness" value={s.flowSmoothness} min={0} max={1} step={0.01} onChange={(v) => set({ flowSmoothness: v })} />
      </section>

      <section className="card">
        <h2 className="card__title">Layering</h2>
        <Slider label="Cross-hatch" value={s.crossHatch} min={0} max={1} step={0.01} onChange={(v) => set({ crossHatch: v })} />
        <Slider label="Edge break dist" value={s.edgeBreakDist} min={0.5} max={4} step={0.1} display={`${s.edgeBreakDist.toFixed(1)}px`} onChange={(v) => set({ edgeBreakDist: v })} />
      </section>

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
            <input type="color" value={p.params.style.ink} onChange={(e) => p.onStyleChange({ ink: e.target.value })} />
          </label>
          <label className="control control--inline">
            <span className="control__label">Paper</span>
            <input type="color" value={p.params.style.paper} onChange={(e) => p.onStyleChange({ paper: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Export</h2>
        <div className="seg">
          <button className={'seg__btn' + (p.format === 'image/png' ? ' seg__btn--active' : '')} onClick={() => p.onFormatChange('image/png')}>PNG</button>
          <button className={'seg__btn' + (p.format === 'image/jpeg' ? ' seg__btn--active' : '')} onClick={() => p.onFormatChange('image/jpeg')}>JPG</button>
          <button className={'seg__btn' + (p.format === 'image/svg+xml' ? ' seg__btn--active' : '')} onClick={() => p.onFormatChange('image/svg+xml')}>SVG</button>
        </div>
        <button className="export" disabled={!p.hasImage || p.busy} onClick={p.onExport}>
          {p.busy ? 'Working…' : `Export ${p.format === 'image/png' ? 'PNG' : p.format === 'image/jpeg' ? 'JPG' : 'SVG'}`}
        </button>
      </section>
    </aside>
  )
}
