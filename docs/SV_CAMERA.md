# Street View camera height (calibration, 2026-09-29)

All SV-based ground measurements used to assume the camera is **2.5 m** above the road
(`scripts/sv-ortho.mjs` `CAM_H`, street briefs `d = 2.5 / tan(depression)`, `compare.tmp.mjs` eye 2.5).
A street agent found SV sidewalk widths ~15 % too wide. This file measures the real height per capture set.

## Result

| capture set (index `date`) | camera hardware (visible sign) | **H above the road under the car** | used as |
|---|---|---|---|
| **2025-09** (268 panos, all `extra/` 40° frames of the Mertkent area, da1, da3 east, 503 Sk.) | new rig: large blurred car-roof patch below ≈15–25° depression | **2.35 ± 0.07 m** | `CAM_H` 2.35 |
| **2019-05** (KOxF, JDIg, Dr35, j-FH, 82Ov — da2 ground frames) | older rig, nadir not blurred | **2.55 ± 0.10 m** | `CAM_H` 2.55 |
| **2014-07** (EIX3, HdorT, NKeY, ivFD, NoC) | older rig, nadir not blurred | **2.85 ± 0.15 m** | `CAM_H` 2.85 |

**Kerb height matters as much as H.** A point on a raised sidewalk is only `H − kerbH` (≈ H − 0.15) below the camera.
For 2025 frames that is 2.20 m, so a sidewalk width measured with `d = 2.5/tan δ` is **12 % too wide**
(factor 2.20/2.5 = 0.88); a road-level width is 6 % too wide (2.35/2.5 = 0.94). This explains the retro agent's
"h_eff ≈ 2.15–2.3" (it measured sidewalks). For 2019 frames: road ×1.02, sidewalk ×0.96; 2014: road ×1.14, sidewalk ×1.08.

Correct formula (pitch −50 frame, centre column, pixel row v, fov 90 → f = 320 px; other fovs f = 320/tan(fov/2)):
`d = H_eff / tan(50° − atan((319.5 − v)/320))`, `H_eff = H(date)` for road paint/asphalt, `H(date) − kerbH` for
sidewalk points. Off-centre columns: use the full ray (depression = atan(−ray_y / |ray_xz|)).
Far points are pitch-sensitive: 0.3° of pano tilt changes d by 1.4 % at 7 m and 3 % at 15 m; take absolute widths from
the aerial or stone counts and use SV for ratios on one surface.

## Methods

Camera model: 640 px pinhole, principal point 319.5, `cam(h,p,fov)` as in `sv-ortho.mjs`. Checked: the same five
kerb/tactile/edge-line features in JDIg `0_-50` and `0_0` map to the same elevation within ≤0.9 px (0.15°).
Pano levelling: vanishing point of building verticals in 34 frames at p=40 (11 panos) → mean −0.07°, s.d. 0.3° per
frame; horizontal facade lines (JDIg 60/300) within 0.1°. Tools: scratchpad `camh/` (`geo.mjs`, `along2.mjs`,
`zebra3.mjs`, `gdist.mjs`, `vert.mjs`, `roof.mjs`, `vvp.mjs`, `hvp.mjs`).

- **(a) ground plane.** Two parallel painted lines are traced row by row, mapped to the ground for unit height, and the
  pitch is set where the mapped lines are parallel (ground-plane vanishing point = horizon of the road plane). True
  spacing from Google z21 aerial profiles (0.083 m/px, ±1.5 m along-road averaging) at the same stretch.
  H = W_aerial / w₁. Zebra: stripe period (standard 1.0 m; aerial 0.995 m over 8 periods).
  Manholes: distance of two covers in the aerial vs mapped distance.
- **(b) vehicles.** Published wheelbase between the two near-side hub centres (mapped to the hub plane, H − r, r = tyre
  radius) — insensitive to the camera being above the roof. Roof method H = (h_roof·k + Δ)/(k − c₁) with the
  silhouette point Δ beyond the near wheel line (tangent-point model) reported for comparison only.
- **(c) pedestrians.** Standing/walking adults, feet and head top, H = h·tan δ_feet/(tan δ_feet − tan δ_head)
  (+ kerb when on a sidewalk); women h = 1.62 ± 0.07 (headscarf/long-coat older women 1.55–1.60), men 1.75.

## Measurements

| # | frame | set | method | inputs | H (m) |
|---|---|---|---|---|---|
| 1 | `LKuSQf… 21/-15/40` | 2025 | a zebra (502 Sk., yellow, z −22.5) | 3 periods = 1.2698·H (dp 0) | 2.36 (P 1.00) / 2.42 (P 1.023, aerial for those stripes); ±0.03 per ±0.25° |
| 2 | `Ng8IaL… 270/-50` | 2025 | a DA lines, x 43–55 | aerial S–N 5.90, C–N 2.87, S–C 3.03; w₁ 2.526 / 1.207 / 1.318 | 2.34 / 2.38 (C–N parallel at dp 0.06) / 2.30 |
| 3 | `4hcOHE… 270/-50` | 2025 | a DA lines, x 126–146 | aerial S–N 6.11, C–N 2.85, S–C 3.25; all pairs parallel at dp +0.15° | 2.37 / 2.32 / 2.41 (dp 0: 2.39 / 2.34 / 2.44) |
| 4 | `UKQgBJ… 60/0` | 2025 | b BMW 5-series F10 (wb 2.968, h 1.464), 11 m | hubs (363.2,379.1)/(460.9,390.5), r 0.339; tyres; roof row 342.3 | 2.29 hubs, 2.26 tyres, 2.20 roof; ±0.06 pitch; F01 7-series would give 2.35 |
| 5 | `BJWF6w… 0/0` | 2025 | c two women on the shop forecourt (+0.12) | H/h 1.25, 1.26 | 2.15, 2.15 (2.07–2.27 for h 1.55–1.72) |
| 14 | `zDExpl… 0/0` | 2025 | b Ford Tourneo/Transit Courier (wb 2.489), 7 m | hubs (440,473.1)/(572.5,445), r 0.31 | 2.20 (±0.03 pitch, ±0.03/px; Tourneo Connect 2.662 would give 2.33) |
| 6 | `JDIgP_… 0/-50` + `180/-50` | 2019 | a edge line to edge line, x 210 | 2.509·H (tilt-robust); aerial 6.31 | 2.52 (2.47 after −0.04 m crown) |
| 7 | `KOxFy1… 90/-50` | 2019 | a N–S edge lines, x 204–212 | 2.544·H at dp −0.52 (2.579 at dp 0); aerial 6.26 | 2.46 (2.43) |
| 8 | `Dr35Ny… 0/-50` | 2019 | b Citroën C-Elysée/Peugeot 301 (wb 2.652), 3 m | hubs (307.5,241.5)/(526.7,243.3), r 0.31; tyres | 2.68 hubs, 2.66 tyres (±0.05; street crossfall ±0.06); roof model 2.39 (not used: camera 1.2 m above roof at 3 m) |
| 9 | `KOxFy1… 270/-50` | 2019 | c woman (headscarf, long coat) at 8 m | feet (65,145), head (6,38.5): H/h 1.66 | 2.57–2.65 (h 1.55–1.60) |
| 10 | `JDIgP_… 240/0` | 2019 | c same woman at 18 m | feet 368.5, head 341: H/h 1.79 | 2.77–2.86 (low weight: 27 px tall) |
| 11 | `HdorTB… 270/-50` | 2014 | c woman (headscarf) at 7 m | feet (233,147), head (213,38) | 2.67 (h 1.63; 2.59–2.78) |
| 12 | `EIX3i6… 90/-50` | 2014 | b Ford Fiesta Mk6 (wb 2.486), along view | hubs (470,206)/(542.5,336), r 0.29 | 2.93 ± 0.12 |
| 13 | `EIX3i6… 90/-50` | 2014 | a two manhole covers | 1.0905·H; aerial (290.9,−53.2)–(293.7,−51.7) = 3.16 m | 2.90 (cover identity: the pair Dr35 cannot see because the first cover lies under the parked car) |

Not used for calibration: sidewalk bands in JDIg `0_-50` against the aerial give 2.2–2.35 — the sidewalk surface
height (kerb face measured 0.10 m, cross slope unknown) and 2019→aerial changes dominate; SV ground frames should not be
calibrated on raised surfaces. 2019 paint vs aerial (#6, #7) may differ (the aerial shows no centre line where 2019 SV
has one), which is why 2019 carries ±0.10.

Consistency: 2025 ground-plane estimates 2.30–2.42 (7 pair/zebra values, mean 2.36, s.d. 0.04) — this is the
*effective* height above painted road lines (they lie ≈0.04 m below the lane under the car because of the camber) and it
is exactly the number that converts SV ground distances. Object methods are lower (BMW 2.20–2.29, Courier 2.20,
pedestrians 2.15; each ±0.1 because of model/height priors) → physical mast height ≈2.30 ± 0.08. Adopted 2.35 ± 0.07. 2019: paint 2.43–2.52, objects 2.57–2.68 → 2.55 ± 0.10.
2014: 2.67–2.93 → 2.85 ± 0.15. The three generations differ by more than their errors; one constant is wrong for all.

## What was changed

- `scripts/sv-ortho.mjs`: `CAM_H` → `camH(p.date)` (2025 2.35, 2019 2.55, 2014 2.85, else 2.5; `SV_CAM_H` env overrides).
  Facade orthos only shift vertically with the camera height (horizontal position and vertical scale come from the
  pano–plane distance). The survey `base` values in `scripts/sv-extra.json` were fitted visually per edge with 2.5 m,
  i.e. they already contain +0.15 m for 2025 panos (−0.05 for 2019, −0.35 for 2014). Regenerated orthos therefore show
  the same pixels 0.15 m lower in the window; the red ground line would sit 0.15 m above the facade foot until `base`
  is lowered by `2.5 − H`. Survey heights are measured from that line, so compiled facades do not change.
  To regenerate orthos identical to the old ones use `SV_CAM_H=2.5`.
- `compare.tmp.mjs` (gitignored): default eye = camera height of the view's pano date (photos keep 2.5);
  `scripts/compare-views.json`, `critic-views*.json`: explicit `eye` per view from its pano date.
- `src/worlds/mertkent/data/street-plan.json` (da entries only; each change noted as "H-kalibrasyon: a→b"):
  see the list in the agent report / entry notes. Aerial- or stone-count-checked widths were left unchanged; band
  ratios on one surface are scale-free and were kept.
- Scratchpad briefs: formula and heights updated.

Not changed (same 2.5 m, only a vertical offset or not in use): `sv-ortho-perimeter.mjs`, `sv-plane.mjs`,
`sv-survey-plan.mjs`, `sv-align.mjs`, `bake-streetview.mjs` (reads `index.camHeight` = 2.5 written by
`fetch-streetview.mjs`; changing it would move the baked façade crops) — switch them to the same table when they are
next used for measurement.
