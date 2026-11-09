# windowception

A minimal endless ball-rolling game. One continuous graphite stroke winds down
an empty page; you roll down it and steer to stay on. No score, no HUD, no text.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # static build in dist/
```

## Controls

`A` / `D` steer left and right. `W` and `S` ease the roll speed up and down.
Nothing else — there is no jump, and no menus.

## How the track works

The road is one aperiodic stroke, built by integrating a sum of heading octaves
along distance travelled, so it is `C1` with no corners and never doubles back:

```text
heading(s) = sum over octaves of  A_n * sin(2*pi*s / L_n + phase_n)
```

Wavelengths halve each octave, so the curve holds structure at every scale. The
heading is soft-clipped inside `(-pi/2, pi/2)`, which guarantees the path stays
descending everywhere and is therefore always rideable.

Two details make it play well:

- **Drawn track vs ride corridor.** The wash under the line is exactly the
  rideable corridor, so its edge is honest about where you will fall. Only the
  first few hundred units taper in, so the run opens on a single thin line.
- **Curvature is low-passed for physics.** A rolling ball averages over its
  contact patch, so the ball only feels the coarse bends. The fine octaves are
  visual texture; without this filter they flip the curvature's sign every few
  units, the outward push cancels out, and the game plays itself.

The renderer samples the stroke evenly in screen space and smooths it with a
radius that grows with distance, so fine octaves dissolve in the distance and
resolve as you roll into them: the continuous zoom into a self-similar curve.

## Layout

| Path | Purpose |
| --- | --- |
| `src/fractal.ts` | Track geometry: heading octaves, arc-length integration, tint |
| `src/render.ts` | Perspective camera, level-of-detail reveal, ball |
| `src/main.ts` | Input, lateral dynamics, fall and respawn |
| `src/noise.ts` | Hash, value noise, fBm helpers |

`scripts/tune.ts` and `scripts/fall.ts` are tuning harnesses for the lateral
dynamics; opening the game with `?debug=1` exposes the state they read.
