/** Deterministic integer hash -> [0,1). */
export function hash(i: number, seed: number): number {
  let x = (i | 0) ^ Math.imul(seed | 0, 0x9e3779b9);
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i, seed);
  const b = hash(i + 1, seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/**
 * Fractional Brownian motion: octaves of value noise, each at a higher
 * frequency and a fixed fraction of the amplitude. Statistically self-similar,
 * which is what makes the derived curve read as fractal rather than wavy.
 */
export function fbm(x: number, octaves: number, lac: number, gain: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let k = 0; k < octaves; k++) {
    sum += amp * (noise1(x * f, seed + k * 131) * 2 - 1);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
