import { Track } from '../src/fractal';

/**
 * Offline harness for the lateral dynamics. The numbers here are the ones the
 * page uses, so tuning stays honest.

 * Model: the ball's lateral position is in corridor fractions, -1..1. Steering
 * drives a lateral velocity; releasing lets that velocity decay, so the ball
 * *holds* its line rather than springing back to the middle. Curvature pushes it
 * toward the outside of the bend. Nothing stops it leaving the corridor, which
 * is what makes the edge something to be steered against.
 */
const track = new Track(1);

const STEER = 2.2; // corridor-fractions / s^2
const DRAG = 6.0; // lateral velocity decay when hands-off
const CENTRIFUGAL = 0.0009; // outward push per unit curvature * speed^2

function simulate(speed: number, windows: [number, number][], seconds = 14) {
  const dt = 1 / 240;
  let s = 2000;
  let u = 0;
  let v = 0;
  let t = 0;
  let maxU = 0;
  let fellAt: number | null = null;

  while (t < seconds) {
    const steer = windows.some(([a, b]) => t >= a && t < b) ? 1 : 0;
    const k = track.curvature(s);
    v += steer * STEER * dt;
    v -= v * DRAG * dt;
    v += -k * speed * speed * CENTRIFUGAL * dt;
    u += v * dt;
    if (Math.abs(u) > maxU) maxU = Math.abs(u);
    if (Math.abs(u) >= 1) {
      fellAt = t;
      break;
    }
    s += speed * dt;
    t += dt;
  }
  return { maxU: +maxU.toFixed(2), fellAt: fellAt === null ? null : +fellAt.toFixed(1), dist: Math.round(s - 2000) };
}

console.log('hands-off (should survive everywhere):');
for (const sp of [40, 58, 93]) console.log(`  speed ${sp}:`, JSON.stringify(simulate(sp, [])));

console.log('\nbrief correction 0.4s (should barely move):');
console.log(' ', JSON.stringify(simulate(58, [[1, 1.4]])));

console.log('\nhold 1.2s (should approach edge but recover):');
console.log(' ', JSON.stringify(simulate(58, [[1, 2.2]])));

console.log('\nhold 3s (should fall):');
console.log(' ', JSON.stringify(simulate(58, [[1, 4]])));

console.log('\nhold 1s then release then correct back:');
console.log(' ', JSON.stringify(simulate(58, [[1, 2], [3.2, 3.6]])));

console.log('\nhold 1s then hold opposite 1s (S-weave):');
console.log(' ', JSON.stringify(simulate(58, [[1, 2], [3, 4]])));
