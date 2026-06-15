# Engraver Webapp — Improvement Roadmap

*Produced by a multi-agent audit (code, UX, performance, output fidelity, robustness) grounded in
the real source. Reviewer score 7/10. Companion to AUDIT.md and AUTOTUNE.md.*

## Verified findings (checked against source)
- **Taper bug** — `strokeCanvas.ts:44` applies the 20% end-taper to *every* stroke, flattening interior hatch ends (per-vertex widths are otherwise honored at line 52).
- **Edge map** — `field.ts` computes raw Sobel magnitude (normalized + box-blurred). It is *live* (used via `field.edge`), but it is **not** FDoG — no NMS/hysteresis, so contours seed on texture noise.
- **`edgeBreakDist` is dead** — `streamlines.ts:137` uses the hardcoded `EDGE_BREAK = 0.5`; the slider value is never read.
- **Stroke cap is incomplete** — the 80k cap (`streamlines.ts:226`) breaks the seed loop only; `integrate()` has its own `MAX_STEPS = 2200` inner loop, so a single dark region can overrun before the cap is consulted.
- **Single fillStyle** — `strokeCanvas.ts:31` sets one ink color for the whole batch; per-stroke color needs color-bucket batching.

---

## 1. Executive Summary — highest-leverage moves

The engine is good; the app around it is fragile at the edges and stuck on the main thread. Six dominate:

1. **OffscreenCanvas: move rendering AND export into the worker; re-tint becomes a 2-string message.** Biggest perf + responsiveness win; unblocks resolution bump and mobile. Caveat: export (SVG/PNG) must move into the worker too, since it currently reads main-thread geometry.
2. **Three near-free fidelity fixes:** remove the unconditional end-taper, add ETF smoothing iterations, replace raw-Sobel edges with coherent FDoG (which finally makes `edgeBreakDist` meaningful).
3. **Fix blank/stuck failure modes:** `worker.onerror`, React error boundary, unsupported-browser fallback, busy-watchdog. A single throw today paints grey and hangs "engraving…" forever.
4. **Reversible + legible:** Reset-to-auto + undo, hold-to-compare with the source (pointer-events), slider tooltips + Simple/Advanced split.
5. **Worker efficiency:** cache the structure-tensor field keyed by `(source, flowSmoothness)`, send the source once (transferred, not cloned), cancel superseded jobs via a polled generation counter (not terminate/respawn).
6. **Perf-timing baseline first** — wrap `engrave()`/`drawEngraving()` in `performance.now()` so every perf claim is measured, not asserted.

---

## 2. Quick Wins (high impact, low effort)

| # | Item | File/area | Impact | Effort |
|---|------|-----------|--------|--------|
| Q1 | `worker.onerror`/`onmessageerror` → clear `busy`, friendly error | App.tsx | H | S |
| Q2 | React error boundary + unsupported-browser feature-detect | main.tsx | H | S |
| Q3 | Make 20% end-taper conditional (free ends only, not interior hatch) | strokeCanvas.ts:44–52 | H | S |
| Q4 | Wire `edgeBreakDist` (or remove slider) — gate behind B2 | streamlines.ts:42,137 | M | S |
| Q5 | Add 2–3 ETF smoothing iterations over the tensor | field.ts:75–76 | H | S |
| Q6 | Batch ribbons into one `Path2D` **per tint bucket**, one `fill()` each | strokeCanvas.ts | H | S |
| Q7 | Split `render()` into `resize()`/`redraw()`; guard backing-store realloc; rAF resize | App.tsx | H | S |
| Q8 | Cheap interim re-tint cache — *throwaway, deleted by B1; skip if M2 near* | strokeCanvas.ts | L | S |
| Q9 | Delete `classifyImage`/vestigial `autoStyle`; neutral "Auto" badge | App.tsx, presets.ts | L | S |
| Q10 | "Reset to auto" + undo/redo (params history stack) | App.tsx, Controls.tsx | H | S |
| Q11 | Hold-to-compare with source (Pointer Events + `touch-action:none`) | App.tsx | H | S |
| Q12 | Promote auto-tune notes to a dismissible sidebar panel | App.tsx, styles.css | M | S |
| Q13 | Whole-stage drag-and-drop + clipboard paste upload | App.tsx | M | S |
| Q14 | Slider tooltips + Simple/Advanced disclosure | Controls.tsx | H | S |
| Q15 | Validate/clamp/sanitize loaded preset JSON + embed `version` field | App.tsx | M | S |
| Q16 | Shared `WorkerRequest`/`WorkerResponse` discriminated union | types.ts | M | S |
| Q17 | Cache raw field by `(source, flowSmoothness)`; re-snap planar; transfer source once | engrave.worker.ts, App.tsx | H | M |
| Q18 | Cooperative cancellation via polled generation counter (also inside `integrate()`) | streamlines.ts, App.tsx | M | S |
| Q19 | Copy-image-to-clipboard + URL-hash share link | App.tsx | M | S |
| Q20 | OG/Twitter meta + favicon + description + theme-color | index.html | M | S |
| Q21 | a11y + pointer pass: ARIA, `:focus-visible`, touch-action on sliders/canvas, darker `--muted` | Controls.tsx, styles.css | M | S |
| Q22 | One responsive breakpoint: panel → drawer below ~900px, `100dvh` | styles.css | M | S |
| Q23 | Input size/dimension guard; branch HEIC vs too-large vs corrupt errors | App.tsx | M | S |
| Q24 | Perf-timing baseline around `engrave()`/`drawEngraving()` | engrave.worker.ts, strokeCanvas.ts | M | S |

---

## 3. Bigger Bets (high impact, higher effort)

| # | Item | Impact | Effort | Note |
|---|------|--------|--------|------|
| B1 | OffscreenCanvas render **and export** in the worker; re-tint = 2-string message | H | M | Subsumes Q8; rewrites export path |
| B2 | True FDoG coherent edges (NMS + hysteresis) replacing raw Sobel | H | M | Keystone fidelity fix; makes Q4 meaningful |
| B3 | Multi-tone / color retention — carry chroma through placement, render via per-tint buckets | H | H | Pipeline-data change (luminance collapse at engrave.ts:128); answers "references retain color" |
| B4 | Subject/background masking — v1 border flood-fill (zero bg darkness pre-placement); defer ML matte | H | H | Biggest subjective jump on real uploads |
| B5 | Raise field resolution 760→~1280px — gated behind B1+B6 + preset versioning | M | M–H | Real reason PNG/JPG look soft (760→2000 upscale); breaks saved presets (RNG depends on res) |
| B6 | Replace 80k cap with point-budget + time-box checked **inside `integrate()`**; adaptive mobile res/DPR/budget | H | M | A single dark region can overrun today |
| B7 | Vitest + golden tests for the pure compute core; pin RNG determinism | M | M | Core is pure/deterministic and untested |
| B8 | Lozenge cross-hatch + ink-multiply at intersections | M | M | Cross-hatch locked to 90°, crossings don't darken |
| B9 | PWA: manifest + service worker | M | M | Fully client-side → ideal installable/offline |
| B10 | Preallocate streamline typed arrays; emit into packed buffers | M | M | `number[]`/per-stroke array churn → GC pauses |

---

## 4. Polish & Robustness Backlog

P1 CSP/security meta · P2 reframe `default.png` as explicit demo (shrink/lazy) · P3 export UX
(label PNG/JPG as 760→2000 upscale; SVG as only true-res; post-B1) · P4 localStorage saved looks +
thumbnails · P5 move `scheduleRecompute` out of `setParams` updater + clear timer on unmount ·
P6 ~30s busy watchdog + live region · P7 separate "initial" vs "re-tune" busy state · P8 move
`PackedStrokes` to types.ts · P9 expose/document hidden params · P10 CI npm cache + Node 22 +
typecheck gate · P11 build sourcemaps / error capture · P12 `*.tsbuildinfo` → `.gitignore` ·
P13 paper grain + ink-bleed feather · P14 guilloché/banknote framing (do last) · P15 wrap export
`getContext('2d')!` in try/catch.

---

## 5. Recommended Sequencing

**Milestone 1 — stop the bleeding + free wins + measure (1–2 wks, all low-effort, parallelizable):**
Q24 (measure first) → robustness Q1, Q2, Q15, Q23 → fidelity Q3, Q5 (defer Q4 to M2) → perf Q6, Q7,
Q17, Q18 (skip Q8 unless B1 slips) → UX Q9–Q14 → infra/a11y Q16, Q20, Q21, Q22, Q19. Start B7
(tests) early as a safety net.

**Milestone 2 — off the main thread + true engraving (2–4 wks):**
B1 (OffscreenCanvas render+export) → B6 (budget/time-box cap) + B10 → B2 (FDoG) then Q4 →
B5 (760→1280, only after B1+B6, with Q15 preset-version migration).

**Milestone 3 — premium output + reach:**
B3 (color retention) + B4 (background mask) — the two biggest "matches the references" jumps →
B8 (lozenge/multiply) → B9 (PWA) → backlog P-items as capacity allows.

**Critical-path notes:**
- B5 must follow B1+B6 and ship with preset versioning (changes every saved preset's output).
- B1 forces export into the worker — plan P3 around it.
- Q6 and B3 are only compatible via per-tint-bucket batching.
- Cancellation (Q18) must be cooperative, not terminate/respawn, or it defeats the Q17 field cache.
