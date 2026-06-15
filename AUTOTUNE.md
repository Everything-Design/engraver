# Auto-Tune Plan — analyze any image, derive the engraving parameters

*Design doc for an upgraded "Auto" mode. Companion to AUDIT.md. Status: planned, not yet built.*

## Goal

Replace "pick one of 3 presets" with a per-image fit: on upload, **measure the image's
real properties** (levels, contrast, key, background, busyness, orientation, skin, color),
then **derive all Structure params + a suggested duotone** so the result looks right with
zero slider work. Sliders become optional fine-tuning.

Heuristic + explainable (measurable → rule), not ML. Fast single CPU pass. Deterministic.

## Architecture

```
analyze(imageBitmap) → ImageStats          // src/engine/analyze.ts (new)
mapToParams(ImageStats) → { structure, style, notes } // src/engine/autoParams.ts (new)
```

Wire into App.processBitmap: replace `classifyImage()` + preset apply with
`mapToParams(analyze(bitmap))`. Keep the 3 presets as named manual starting points; "Auto"
becomes the default and is a true per-image fit. Existing engine/UI/worker unchanged — this
only generates better starting values.

## ImageStats (the "look into the image" step)

Compute from a downscaled copy (long edge ~160–200px) composited on white:

| Field | Definition |
|---|---|
| `p2,p50,p98` | luminance percentiles (2nd / median / 98th) |
| `mean,std` | luminance mean + std dev (std = contrast proxy) |
| `dynRange` | p98 − p2 |
| `key` | mean (low = dark/low-key, high = bright/high-key) |
| `bgLum, bgVar` | mean + variance of a border ring (outer ~8% frame) |
| `bgKind` | 'light-uniform' \| 'dark-uniform' \| 'busy' (from bgLum + bgVar thresholds) |
| `subjectCoverage` | fraction of pixels whose \|lum − bgLum\| > τ (subject vs background) |
| `busyness` | fraction of strong-gradient pixels (Sobel mag > τ) |
| `axisRatio` | fraction of strong edges within ±15° of horizontal/vertical |
| `skinRatio` | fraction passing the skin-tone test (reuse classifyImage logic) |
| `sat` | mean HSV saturation |
| `hue` | mean hue of saturated pixels (circular mean), + warm/cool flag |

All cheap; one pass for luminance/hist/skin/sat/hue, one Sobel pass for busyness/axis/edges,
one border pass for bg stats.

## mapToParams (the "auto-twin" step)

Deterministic rules. Clamp every output to the param's valid range (see types.ts).

**Tone (auto-levels — fixes most "looks wrong" cases):**
- `blackPoint = clamp(p2 − 0.02, 0, 0.35)`
- `highlightClip`: if `bgKind === 'light-uniform'` → `min(bgLum − 0.04, p98)` (background → bare paper);
  else `clamp(p98 + 0.02, 0.6, 1)`
- `gamma = clamp(0.6 + (0.5 − key) * 1.2, 0.5, 1.8)`  (dark image lifts mids, bright holds)
- `tonalLevels = round(lerp(5, 10, smoothness))` where `smoothness = 1 − clamp(busyness*3,0,1)`
  (smooth portraits → more bands; graphic/high-contrast → fewer)

**Line geometry:**
- `basePitch = lerp(8, 4, busyness)`  (busy/fine detail → tighter)
- `spacingRatio = lerp(4, 7, dynRange)`  (more dynamic range → more tonal contrast in spacing)
- `strokeWidth ≈ 0.85` (mostly constant; ×1.1 for low-key images)
- `swell = 0.5` (constant-ish; 0.65 for organic, 0.3 for architectural)
- `latticeJitter = lerp(0.25, 0.45, smoothness)` (smooth flats need more anti-lattice)

**Direction & structure:**
- `planarRegions = axisRatio > 0.5 && skinRatio < 0.08`
- `baseAngle`: planar → dominant non-axis peak (or 45); else 0 for portraits, 35 otherwise
- `flowWeight = planarRegions ? 0.5 : lerp(0.7, 0.92, orientationVariance)`
- `flowSmoothness = lerp(0.4, 0.85, 1 − axisRatio)` (organic → smoother flow)

**Layering:**
- `crossHatch = clamp(shadowFraction * 1.5, 0.1, 0.85)` where `shadowFraction = % lum < 0.3`
- `stippleTransition = clamp(midGradientFraction, 0.2, 0.7)` (smooth mid-tone gradient → more)
- `edgeStrength = clamp(0.6 − busyness, 0.2, 0.7)` (clean subject → bolder contours; noisy → back off)
- `edgeBreakDist ≈ 1.5`

**Duotone (from color):**
- warm/skin (`hue` orange-red, or skinRatio high) → Sepia Brown or Oxblood Rose
- cool (`hue` blue) → Intaglio Blue
- green cast → Intaglio Green
- low `sat` (near-neutral) → Charcoal or Steel Grey
- paper tint = the preset paper paired with the chosen ink (never pure white)

**Notes (surface to user):** e.g. "Dark background detected — consider Invert or background
removal" when `bgKind === 'dark-uniform'`; "Busy background — subject not isolated" when 'busy'.

## Background handling (the consequential branch)

The border sample decides the most important behavior:
- **light-uniform** → clip highlights below bg → background becomes bare paper (the hedcut look).
- **dark-uniform** → recommend `invert` (light-on-dark) OR hold as solid ink; flag it, don't silently flood.
- **busy** → can't isolate; lower `edgeStrength`, accept fuller hatch, or trigger masking (below).

## The hard part — segmentation (deferred / optional)

Border-sampling isolates subjects only on clean, separable backgrounds (studio portraits,
cut-outs — most uploads for this style). Busy backgrounds need real segmentation:
- **v1 (ship first):** flood-fill from border pixels at a tolerance → rough subject mask;
  use mask to (a) keep background as bare paper, (b) scope density to the subject. Cheap, no deps.
- **v2 (optional):** in-browser ML background removal (e.g. an ONNX/MediaPipe segmentation
  model) for robust masking on busy scenes. Adds weight + load time; only if needed.

When a mask exists, set background pixels' darkness to 0 (bare paper) before streamline placement.

## Implementation checklist (next session)

1. `src/engine/analyze.ts` — `analyze(bitmap): ImageStats` (downscale + 3 passes above).
2. `src/engine/autoParams.ts` — `mapToParams(stats): { structure: StructureParams; style: StyleParams; notes: string[] }`, clamped.
3. `App.tsx` — in `processBitmap`, call analyze→mapToParams; setParams + scheduleRecompute;
   show `notes` (e.g. a small banner) and set `autoStyle = null` or a derived label.
4. Keep `classifyImage`/PRESETS for the manual preset buttons.
5. (Optional v1) `src/engine/mask.ts` — border flood-fill mask; apply in `engrave.ts` to zero
   background darkness.
6. Build, test on the 3 references + the default worker image (transparent bg), tune constants.

## Validation

Run the 4 known images (building / portrait / cube / worker-on-white) through Auto and confirm:
bare-paper backgrounds where expected, no flooding, sensible ink choice, lines follow form.
The `notes` should correctly flag the worker image's (now white-composited) background as light.
