// Parameter model for the streamline engraver (per AUDIT.md §4).
// Split into Structure (forces a render-on-release recompute) and Style (real-time).

export interface StructureParams {
  // Tone
  tonalLevels: number // posterization steps before line placement (3–12)
  blackPoint: number // luminance mapping to full ink (0–0.4)
  highlightClip: number // luminance above which = bare paper (0.6–1)
  gamma: number // midtone bias (0.5–2)
  // Line geometry
  basePitch: number // mid-band spacing px @ field res (2–16)
  spacingRatio: number // darkest:lightest spacing ratio (2–10)
  strokeWidth: number // base ink width px (0.4–2)
  swell: number // width variation by tone (0–1)
  latticeJitter: number // anti-lattice spacing/phase break-up (0–1)
  // Direction & structure
  flowWeight: number // fixed-angle ↔ ETF blend (0–1)
  baseAngle: number // fixed component angle, degrees (0–180)
  planarRegions: boolean // region-planar orientation (Building)
  flowSmoothness: number // field smoothing radius (0–1)
  // Layering & transitions
  crossHatch: number // cross-hatch layers/engagement (0–1)
  stippleTransition: number // tapered line-end flicks in lightest band (0–1)
  edgeStrength: number // FDoG/edge contour reinforcement (0–1)
  edgeBreakDist: number // streamline termination distance near edges, px (0.5–4)
}

export interface StyleParams {
  ink: string // hex
  paper: string // hex, tinted (never pure white)
}

export interface EngraveParams {
  structure: StructureParams
  style: StyleParams
}

export interface Duotone {
  name: string
  ink: string
  paper: string
}

export const DUOTONES: Duotone[] = [
  { name: 'Intaglio Green', ink: '#27513f', paper: '#eef4ee' },
  { name: 'Sepia Brown', ink: '#5b4636', paper: '#f7f4ee' },
  { name: 'Oxblood Rose', ink: '#a65b50', paper: '#f6ece8' },
  { name: 'Intaglio Blue', ink: '#1f3a5f', paper: '#eef1f6' },
  { name: 'Steel Grey', ink: '#3a3f44', paper: '#f1f1ee' },
  { name: 'Charcoal', ink: '#222020', paper: '#f3f1ea' },
]

export const DEFAULT_PARAMS: EngraveParams = {
  structure: {
    tonalLevels: 6,
    blackPoint: 0.08,
    highlightClip: 0.92,
    gamma: 1.0,
    basePitch: 6,
    spacingRatio: 5,
    strokeWidth: 0.9,
    swell: 0.5,
    latticeJitter: 0.35,
    flowWeight: 0.7,
    baseAngle: 35,
    planarRegions: false,
    flowSmoothness: 0.6,
    crossHatch: 0.4,
    stippleTransition: 0.5,
    edgeStrength: 0.4,
    edgeBreakDist: 1.5,
  },
  style: { ink: DUOTONES[0].ink, paper: DUOTONES[0].paper },
}
