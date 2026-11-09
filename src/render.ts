import { Track, PAPER, GRAPHITE, BALL_R } from './fractal';
import { clamp, smoothstep } from './noise';

const ROWS = 300;
const D_FAR = 5400;

/**
 * Camera above and behind the ball, tilted down the slope.
 *
 * Pitch has to be paired with an eye height rather than chosen alone: with the
 * eye at ground level a steep pitch looks along the surface and the road
 * collapses to a thin line, while raising the eye turns the same pitch into a
 * view that sees the surface from above, so the corridor has visible width and
 * bends read as bends. These values were solved against three anchors: the ball
 * sits four fifths of the way down the frame, the road dissolves into the paper
 * near the top, and a turn of a few corridor widths fills a useful part of the
 * screen.
 */
const TH = 0.9;
const SIN_T = Math.sin(TH);
const COS_T = Math.cos(TH);
const EYE_H = 62;
const EYE_BACK = 62;
const FOCAL_MUL = 1.0;

/**
 * The camera creeps in as the run goes on. Each decade of distance pulls the eye
 * closer by a fixed factor, so the world keeps enlarging without ever running
 * out of detail: the fractal's self-similarity guarantees that whatever scale
 * you arrive at looks like the one you left. Exponential rather than linear, so
 * the zoom neither stalls nor accelerates without bound.
 */
const ZOOM_PER_DECADE = 0.26;
const ZOOM_MAX = 0.72;

/** Where the ball sits vertically, as a fraction of screen height. */
const BALL_SCREEN_Y = 0.8;

export interface Cam {
  rot: number;
}

export interface Ball {
  s: number;
  u: number;
  spin: number;
  /** 0 while riding; grows while the ball is falling away after a miss. */
  fall: number;
}

export class Renderer {
  /** Optional hook fired when the ball leaves the corridor; test instrumentation. */
  onFall?: () => void;

  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private paper = `rgb(${PAPER.join(',')})`;

  private S = new Float64Array(ROWS);
  private PX = new Float64Array(ROWS);
  private PY = new Float64Array(ROWS);
  private D = new Float64Array(ROWS);
  private NX = new Float64Array(ROWS);
  private NY = new Float64Array(ROWS);

  private camX = 0;
  private camY = 0;
  private sr = 0;
  private cr = 1;
  private focal = 1;
  private cx = 0;
  private cy = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private track: Track,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (dpr === this.dpr && w === this.w && h === this.h) return;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';

    // Assigning canvas dimensions clears it, so paint the paper immediately.
    // Without this the canvas is briefly unpainted during a resize, which shows
    // up as a flash of whatever is behind it.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = this.paper;
    this.ctx.fillRect(0, 0, w, h);
  }

  /**
   * How far the camera has crept in, as a multiplier on the base framing.
   * Grows with the logarithm of distance, so every decade of the endless descent
   * enlarges the world by the same factor and the zoom never saturates.
   */
  private zoomFactor(s: number): number {
    return 1 / (1 + ZOOM_PER_DECADE * Math.log10(1 + s / 400) * ZOOM_MAX);
  }

  private setup(camX: number, camY: number, rot: number, ballS: number) {
    this.camX = camX;
    this.camY = camY;
    this.sr = Math.sin(rot);
    this.cr = Math.cos(rot);
    const zoom = this.zoomFactor(ballS);
    this.focal = Math.min(this.w, this.h) * FOCAL_MUL * zoom;
    this.cx = this.w * 0.5;

    // Place the horizon using the pitch, then shift the frame so the ball's own
    // projection lands at BALL_SCREEN_Y. Deriving it from the ball rather than
    // from an arbitrary horizon keeps the ball framed for every pitch/eye pair,
    // which a hand-picked constant cannot promise.
    const depth = EYE_BACK * COS_T + EYE_H * SIN_T;
    const height = EYE_BACK * SIN_T - EYE_H * COS_T;
    this.cy = this.h * BALL_SCREEN_Y + (this.focal * height) / depth;
  }

  private proj(wx: number, wy: number, out: number[]): void {
    const dx = wx - this.camX;
    const dy = wy - this.camY;
    const fwd = dx * this.sr + dy * this.cr;
    const right = dx * this.cr - dy * this.sr;
    const depth = Math.max(8, fwd * COS_T + EYE_H * SIN_T);
    const height = fwd * SIN_T - EYE_H * COS_T;
    out[0] = this.cx + (this.focal * right) / depth;
    out[1] = this.cy - (this.focal * height) / depth;
    out[2] = depth;
  }

  render(cam: Cam, ball: Ball, respawnAlpha = 0) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.paper;
    ctx.fillRect(0, 0, this.w, this.h);

    const back = this.track.at(ball.s - EYE_BACK * this.zoomFactor(ball.s));
    this.setup(back.x, back.y, cam.rot, ball.s);

    // Sample so that rows are roughly evenly spaced *on screen*. Arc-length
    // sampling bunches nearly every row into the first few pixels near the ball
    // (row spacing fell to 0.03 px), which throws away the near field where the
    // fractal detail should be richest. Solving for constant screen spacing
    // costs a few iterations per row and gives the whole frame equal resolution.
    const tmp = [0, 0, 0];
    let sCur = ball.s;
    for (let i = 0; i < ROWS; i++) {
      this.S[i] = sCur;
      const c = this.track.at(sCur);
      this.proj(c.x, c.y, tmp);
      this.PX[i] = tmp[0];
      this.PY[i] = tmp[1];
      this.D[i] = tmp[2];

      // Advance by an arc length that projects to about one row of screen space.
      const targetPx = this.h / (ROWS * 1.6);
      let lo = 0.4;
      let hi = Math.max(4, D_FAR / 8);
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) * 0.5;
        const c2 = this.track.at(sCur + mid);
        this.proj(c2.x, c2.y, tmp);
        const dy = Math.abs(tmp[1] - this.PY[i]) + Math.abs(tmp[0] - this.PX[i]) * 0.35;
        if (dy < targetPx) lo = mid;
        else hi = mid;
      }
      sCur += Math.max(0.5, (lo + hi) * 0.5);
      if (sCur > ball.s + D_FAR) sCur = ball.s + D_FAR;
    }

    this.smoothByDepth();
    this.buildNormals();
    this.drawHalo();
    this.drawStroke();
    this.drawBall(ball, tmp, respawnAlpha);
  }

  /**
   * Screen-space mipmap. The number of samples averaged is proportional to how
   * far ahead the row is, measured in its own screen pixels, so each row keeps
   * exactly the detail its projected size can show. Fine structure therefore
   * appears only when it is large enough to be visible, which is precisely the
   * "the line zooms in and becomes the fractal" behaviour we want.
   */
  private smoothByDepth() {
    const src = new Float64Array(ROWS * 2);
    for (let i = 0; i < ROWS; i++) {
      src[2 * i] = this.PX[i];
      src[2 * i + 1] = this.PY[i];
    }
    for (let i = 0; i < ROWS; i++) {
      let px = 0;
      let py = 0;
      let count = 0;
      // Blur radius in samples: small near, large far.
      const rad = Math.min(26, 1 + 22 * Math.pow(i / (ROWS - 1), 1.5));
      const k = Math.round(rad);
      for (let j = -k; j <= k; j++) {
        const idx = Math.min(ROWS - 1, Math.max(0, i + j));
        const wgt = 1 - Math.abs(j) / (k + 1);
        px += src[2 * idx] * wgt;
        py += src[2 * idx + 1] * wgt;
        count += wgt;
      }
      this.PX[i] = px / count;
      this.PY[i] = py / count;
    }
  }

  private buildNormals() {
    for (let i = 0; i < ROWS; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(ROWS - 1, i + 1);
      let dx = this.PX[b] - this.PX[a];
      let dy = this.PY[b] - this.PY[a];
      const L = Math.hypot(dx, dy) || 1;
      this.NX[i] = -dy / L;
      this.NY[i] = dx / L;
    }
  }

  /**
   * A soft tinted wash hugging the stroke. This is where the muted pastel
   * variety lives: wide enough to read as a slope, faint enough to keep the
   * screen to a single line. Built as one polygon with a vertical gradient so
   * neighbouring tints blend instead of stacking into visible slabs.
   */
  /**
   * A soft tinted wash hugging the stroke. This is where the muted pastel
   * variety lives, and it is also the only cue for where the corridor ends, so
   * its half-width is exactly the rideable corridor. A wash that was wider than
   * the real edge would be a lie: the ball would appear to fall while still over
   * painted ground.
   */
  private drawHalo() {
    const ctx = this.ctx;
    const hw = new Float64Array(ROWS);
    for (let i = 0; i < ROWS; i++) {
      hw[i] = Math.max(1.1, (this.track.visualWidth(this.S[i]) * this.focal) / this.D[i]);
    }

    ctx.beginPath();
    ctx.moveTo(this.PX[0] - this.NX[0] * hw[0], this.PY[0] - this.NY[0] * hw[0]);
    for (let i = 1; i < ROWS; i++) ctx.lineTo(this.PX[i] - this.NX[i] * hw[i], this.PY[i] - this.NY[i] * hw[i]);
    for (let i = ROWS - 1; i >= 0; i--) ctx.lineTo(this.PX[i] + this.NX[i] * hw[i], this.PY[i] + this.NY[i] * hw[i]);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, this.PY[0], 0, this.PY[ROWS - 1]);
    const STOPS = 20;
    for (let k = 0; k <= STOPS; k++) {
      const t = k / STOPS;
      const idx = Math.min(ROWS - 1, Math.round(t * (ROWS - 1)));
      const tint = this.track.tint(this.S[idx]);
      // Fade to nothing before the horizon so the wash has no visible
      // silhouette; it should dissolve into the paper, not end at an edge.
      const fade = smoothstep(0, 0.06, t) * (1 - smoothstep(0.72, 1, t));
      grad.addColorStop(t, `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},${(0.62 * fade).toFixed(4)})`);
    }
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /** The stroke itself: one filled strip, so it never breaks into segments. */
  private drawStroke() {
    const ctx = this.ctx;
    const g = GRAPHITE;

    const lx = new Float64Array(ROWS);
    const ly = new Float64Array(ROWS);
    const rx = new Float64Array(ROWS);
    const ry = new Float64Array(ROWS);
    for (let i = 0; i < ROWS; i++) {
      const hw = Math.max(0.38, (0.85 * this.focal) / this.D[i]);
      lx[i] = this.PX[i] - this.NX[i] * hw;
      ly[i] = this.PY[i] - this.NY[i] * hw;
      rx[i] = this.PX[i] + this.NX[i] * hw;
      ry[i] = this.PY[i] + this.NY[i] * hw;
    }

    ctx.beginPath();
    ctx.moveTo(lx[0], ly[0]);
    for (let i = 1; i < ROWS; i++) ctx.lineTo(lx[i], ly[i]);
    for (let i = ROWS - 1; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, this.PY[0], 0, this.PY[ROWS - 1]);
    grad.addColorStop(0, `rgba(${g.join(',')},0.96)`);
    grad.addColorStop(0.32, `rgba(${g.join(',')},0.9)`);
    grad.addColorStop(0.72, `rgba(${g.join(',')},0.4)`);
    grad.addColorStop(1, `rgba(${g.join(',')},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  private drawBall(ball: Ball, tmp: number[], respawnAlpha: number) {
    const ctx = this.ctx;
    const g = GRAPHITE;
    const c = this.track.at(ball.s);
    const tan = this.track.tangent(ball.s);
    const w = this.track.width(ball.s);
    const bx = c.x - tan.y * w * ball.u;
    const by = c.y + tan.x * w * ball.u;
    this.proj(bx, by, tmp);
    let r = clamp((BALL_R * this.focal) / tmp[2], 3.5, 22);
    let x = tmp[0];
    let y = tmp[1];

    // Falling: the ball drops off the edge, shrinking and drifting as it goes,
    // so a miss reads as falling out of the world rather than as a reset.
    if (ball.fall > 0) {
      const f = ball.fall;
      r *= Math.max(0.15, 1 - f * 0.55);
      y += f * f * 120;
      x += Math.sign(ball.u || 1) * f * 40;
      ctx.globalAlpha = Math.max(0, 1 - f * 1.05);
    } else if (respawnAlpha > 0) {
      // Coming back: grow and fade in, so the respawn is soft rather than a pop.
      r *= 0.35 + 0.65 * (1 - respawnAlpha);
      ctx.globalAlpha = 1 - respawnAlpha;
    }

    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.28, r * 0.85, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${g.join(',')},0.13)`;
    ctx.fill();

    const shade = ctx.createRadialGradient(x - r * 0.32, y - r * 0.36, r * 0.06, x, y, r);
    shade.addColorStop(0, `rgb(${g[0] + 22},${g[1] + 22},${g[2] + 24})`);
    shade.addColorStop(0.72, `rgb(${g.join(',')})`);
    shade.addColorStop(1, `rgb(${Math.max(0, g[0] - 11)},${Math.max(0, g[1] - 11)},${Math.max(0, g[2] - 11)})`);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = shade;
    ctx.fill();

    if (ball.fall <= 0) {
      ctx.beginPath();
      ctx.arc(
        x + Math.cos(ball.spin) * r * 0.44,
        y + Math.sin(ball.spin) * r * 0.44,
        Math.max(0.7, r * 0.14),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(243,242,238,0.5)';
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}
