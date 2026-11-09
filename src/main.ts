import { Track } from './fractal';
import { Renderer, Cam, Ball } from './render';
import { clamp } from './noise';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const q = new URLSearchParams(location.search);
const seeded = q.get('seed');
const track = new Track(seeded !== null ? Number(seeded) : Math.floor(Math.random() * 1e6));
const view = new Renderer(canvas, track);

/** Test hooks: only exposed when the page is opened with ?debug=1. */
const DEBUG = q.get('debug') === '1';

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k.startsWith('arrow')) e.preventDefault();
  keys.add(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', () => view.resize());

const cam: Cam = { rot: 0 };
const ball: Ball = { s: 0, u: 0, spin: 0, fall: 0 };

const RIDE = 58;
/** Fraction of the road heading the camera adopts; see the follow comment. */
const FOLLOW = 0.3;

/**
 * Lateral dynamics, tuned offline in scripts/tune.ts:
 *   - hands-off, the ball holds its line through every bend;
 *   - a short tap nudges it a fraction of the corridor;
 *   - holding a direction for a few seconds walks it off the edge.
 * There is deliberately no spring back to the centre: the corridor is a road to
 * be steered down, not a groove that drives itself.
 */
const STEER = 2.2;
const LAT_DRAG = 6.0;
const CENTRIFUGAL = 0.35;

/** Time the ball spends falling away before it reappears, in seconds. */
const FALL_TIME = 0.85;

let speed = RIDE;
let latVel = 0;
let fallTimer = 0;
/** Fades the ball back in after a respawn, so it never pops. */
let respawn = 0;
let last = performance.now();

/**
 * Recover from a miss without moving the camera. The ball reappears on the line
 * at the same point and carries on: sliding the run backwards to replay ground
 * would snap the whole view and destroy the sense of one continuous descent.
 */
function restart() {
  ball.u = 0;
  ball.fall = 0;
  latVel = 0;
  speed = RIDE * 0.45;
  respawn = 1;
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (fallTimer > 0) {
    fallTimer -= dt;
    ball.fall += dt * 3.4;
    if (fallTimer <= 0) restart();
  } else {
    respawn = Math.max(0, respawn - dt * 2.4);
    const steer =
      (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
      (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const faster = keys.has('w') || keys.has('arrowup');
    const slower = keys.has('s') || keys.has('arrowdown');

    const target = RIDE * (faster ? 1.6 : slower ? 0.4 : 1);
    speed += (target - speed) * Math.min(1, dt * 2.6);
    ball.s += speed * dt;
    ball.spin += (speed * dt) / 1.6;

    // Steering drives a lateral velocity, curvature pushes toward the outside of
    // the bend, and releasing lets that velocity decay. Nothing recentres the
    // ball, so leaving the corridor is a real failure rather than a nudge back.
    const kappa = track.curvature(ball.s);
    latVel += steer * STEER * dt;
    latVel -= latVel * LAT_DRAG * dt;
    latVel += -kappa * speed * speed * CENTRIFUGAL * dt;
    ball.u += latVel * dt;

    if (Math.abs(ball.u) >= 1) {
      ball.u = clamp(ball.u, -1.02, 1.02);
      fallTimer = FALL_TIME;
      view.onFall?.();
    }
  }

  const tan = track.tangent(ball.s);
  const target_rot = Math.atan2(tan.x, tan.y) * FOLLOW;
  let dr = target_rot - cam.rot;
  while (dr > Math.PI) dr -= Math.PI * 2;
  while (dr < -Math.PI) dr += Math.PI * 2;
  cam.rot += dr * (1 - Math.exp(-dt * 1.5));

  view.render(cam, ball, respawn);

  if (DEBUG) {
    (window as unknown as Record<string, unknown>).__state = {
      s: Math.round(ball.s),
      u: +ball.u.toFixed(3),
      fall: +ball.fall.toFixed(2),
      half: +track.width(ball.s).toFixed(1),
      rot: +((cam.rot * 180) / Math.PI).toFixed(1),
    };
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

if (DEBUG) {
  let fells = 0;
  Object.defineProperty(window, '__fells', { get: () => fells });
  view.onFall = () => fells++;
  (window as unknown as Record<string, unknown>).__warp = (s: number) => {
    ball.s = s;
    ball.u = 0;
    ball.fall = 0;
    fallTimer = 0;
    latVel = 0;
    speed = RIDE;
    const tan = track.tangent(s);
    cam.rot = Math.atan2(tan.x, tan.y) * FOLLOW;
  };
}
