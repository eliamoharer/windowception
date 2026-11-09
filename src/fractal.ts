import { clamp, fbm, smoothstep } from './noise';

/**
 * The track is one continuous stroke, defined by its heading as a function of
 * distance travelled and integrated to give the centreline:
 *
 *     x(s) = integral of sin(heading),  y(s) = integral of cos(heading)
 *
 * Integrating a heading (rather than displacing a graph sideways) is what makes
 * this rideable. The curve comes out C1 with no corners, and the heading is soft
 * clipped inside (-pi/2, pi/2), so the tangent always keeps a positive component
 * along the slope. The stroke therefore descends forever and can never double
 * back on itself: every metre of it is genuinely followable.
 *
 * The heading is a sum of sine octaves whose wavelengths halve. That is what
 * makes it fractal rather than merely wavy: the stroke carries the same
 * vocabulary of bends at every scale, so moving into the curve keeps revealing
 * fresh structure of the same character instead of running out of detail.
 */

const TAU = Math.PI * 2;
const STEP = 1;

interface Octave {
  lam: number;
  amp: number;
  ph: number;
}

/**
 * Heading octaves: wavelength, then heading amplitude.
 *
 * A heading amplitude A at wavelength L bends the stroke on a radius near
 * L/(2*pi*A) and wanders it by A*L/2pi. Three requirements set these numbers:
 *
 *  - Sustained bends. A bend only pushes a rolling ball across the corridor if
 *    it lasts long enough to traverse. If every octave had equal amplitude the
 *    finest ones would flip the curvature's sign every few units, the outward
 *    push would average to nothing and the game would play itself. Hence the
 *    taper toward the coarse end.
 *
 *  - Visible fine structure. An octave only reads as detail once it wanders
 *    several world units, which is tens of pixels up close. That is what the
 *    level-of-detail reveal turns into the fractal zoom: near structure appears
 *    as you reach it, and is smoothed away in the distance.
 *
 *  - Rideability. Every radius must stay above the corridor half-width, and the
 *    summed heading is soft clipped inside (-pi/2, pi/2), so the stroke always
 *    descends and never folds back.
 */
const SPEC: [number, number][] = [
  [6400, 0.62],
  [3200, 0.35],
  [1600, 0.2],
  [800, 0.14],
  [400, 0.15],
  [200, 0.17],
  [100, 0.2],
  [50, 0.24],
];

const DRIFT: [number, number] = [16000, 0.32];

/** Only the coarsest octaves steer the ball; see `curvature`. */
const N_COARSE = 4;
const MAX_HEADING = 1.15;
const OPEN_FROM = 40;
const OPEN_TO = 620;

/** Lateral room the ball has to steer within. */
export const CORRIDOR = 4.2;
export const BALL_R = 1.9;

export const PAPER: [number, number, number] = [244, 243, 239];
export const GRAPHITE: [number, number, number] = [44, 46, 51];

const TINTS: [number, number, number][] = [
  [199, 189, 185],
  [186, 195, 189],
  [185, 191, 201],
  [201, 190, 177],
  [192, 184, 199],
  [183, 194, 192],
  [200, 189, 176],
  [189, 183, 195],
];

export interface P {
  x: number;
  y: number;
}

export class Track {
  readonly seed: number;
  private oct: Octave[] = [];
  private drift: Octave;
  private xs: Float64Array;
  private ys: Float64Array;
  private built = 0;

  constructor(seed: number) {
    this.seed = seed;
    for (const [lam, amp] of SPEC) {
      this.oct.push({
        lam,
        amp: amp * (0.92 + 0.16 * fbm(lam * 0.01, 2, 2.1, 0.5, seed * 17 + lam)),
        ph: fbm(lam * 0.003, 4, 2.03, 0.62, seed * 131 + lam * 7) * TAU,
      });
    }
    this.drift = { lam: DRIFT[0], amp: DRIFT[1], ph: fbm(0.37, 3, 2.1, 0.55, seed * 313) * TAU };

    this.xs = new Float64Array(1 << 16);
    this.ys = new Float64Array(1 << 16);
  }

  headingAt(s: number): number {
    const open = smoothstep(OPEN_FROM, OPEN_TO, s);
    if (open <= 0) return 0;
    let h = this.drift.amp * Math.sin((TAU * s) / this.drift.lam + this.drift.ph);
    for (const o of this.oct) h += o.amp * Math.sin((TAU * s) / o.lam + o.ph);
    return MAX_HEADING * Math.tanh(h / MAX_HEADING) * open;
  }

  private ensure(i: number) {
    while (this.built < i) {
      const j = this.built;
      const hm = this.headingAt((j + 0.5) * STEP);
      this.xs[j + 1] = this.xs[j] + Math.sin(hm) * STEP;
      this.ys[j + 1] = this.ys[j] + Math.cos(hm) * STEP;
      this.built++;
      if (this.built + 3 >= this.xs.length) this.grow();
    }
  }

  private grow() {
    const n = this.xs.length * 2;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    xs.set(this.xs);
    ys.set(this.ys);
    this.xs = xs;
    this.ys = ys;
  }

  /** Exact point at distance s. This is the curve the ball rides. */
  at(s: number): P {
    if (s <= 0) return { x: 0, y: s };
    const i = Math.floor(s / STEP);
    const f = s / STEP - i;
    this.ensure(i + 3);
    const x0 = i > 0 ? this.xs[i - 1] : 0;
    const y0 = i > 0 ? this.ys[i - 1] : i - 1;
    return { x: catmull(x0, this.xs[i], this.xs[i + 1], this.xs[i + 2], f), y: catmull(y0, this.ys[i], this.ys[i + 1], this.ys[i + 2], f) };
  }

  tangent(s: number): P {
    const h = 1.5;
    const a = this.at(s - h);
    const b = this.at(s + h);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    return { x: dx / L, y: dy / L };
  }

  /**
   * Curvature as felt by the ball.
   *
   * A ball rolling on a surface averages over its contact patch, so it does not
   * follow the hairline curvature of every fine octave. Physically that is
   * exactly a low pass, and it is what makes the road playable: the fine octaves
   * are visual texture, while the coarse ones are the real turns the player must
   * hold against. Summing all octaves would flip the sign of the curvature every
   * few units, net out to zero, and the game would play itself.
   */
  curvature(s: number): number {
    const h = 6;
    let acc = 0;
    for (let i = 0; i < N_COARSE; i++) {
      const o = this.oct[i];
      const w = (TAU * s) / o.lam + o.ph;
      // d/ds of the heading contribution, averaged over the contact patch.
      acc += -o.amp * (TAU / o.lam) * Math.sin(w) * Math.cos((TAU * h) / o.lam);
    }
    return acc;
  }

  /**
   * Lateral room the ball has to steer within. This is a physics value, so it
   * stays playable from the very first frame; the drawn track is narrower at the
   * start (see `visualWidth`) to give the "starts as one line" opening.
   */
  width(s: number): number {
    const open = smoothstep(0, 520, s);
    const n = fbm(s / 640, 3, 2.07, 0.56, this.seed * 53 + 19);
    return CORRIDOR * (1 + n * 0.26) * (0.72 + 0.28 * open);
  }

  /**
   * Half-width of the *drawn* track. It opens out of a hairline over the first
   * few hundred units, so the run begins as a single thin stroke that widens
   * into a slope as the fractal reveals itself. Only the opening is scaled down:
   * past that it must equal `width` exactly, because the track is the player's
   * only cue for where the edge is.
   */
  visualWidth(s: number): number {
    const open = smoothstep(0, 620, s);
    return this.width(s) * (0.06 + 0.94 * open);
  }

  /** Muted pastel drifting along the stroke; the drift is fractal as well. */
  tint(s: number): [number, number, number] {
    const a = fbm(s / 1150, 3, 2.11, 0.55, this.seed * 13 + 3);
    const b = fbm(s / 340, 2, 2.05, 0.5, this.seed * 29 + 11);
    const t = clamp(0.5 + a * 0.95 + b * 0.22, 0, 0.9999);
    const fi = t * TINTS.length;
    const i = Math.floor(fi) % TINTS.length;
    const j = (i + 1) % TINTS.length;
    const f = fi - Math.floor(fi);
    const A = TINTS[i];
    const B = TINTS[j];
    return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
  }
}

function catmull(a: number, b: number, c: number, d: number, f: number): number {
  const f2 = f * f;
  const f3 = f2 * f;
  return 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
}
