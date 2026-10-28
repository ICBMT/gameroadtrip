/**
 * 2D gradient (Perlin-style) noise built on the deterministic integer hash.
 * Output is roughly in [-1, 1].
 */
import { hashInts } from '../utils/random';

function grad(seed: number, ix: number, iz: number, x: number, z: number): number {
  const h = hashInts(seed, ix, iz, 7) & 7;
  // 8 gradient directions
  const angle = (h * Math.PI) / 4;
  return Math.cos(angle) * x + Math.sin(angle) * z;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function noise2(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const u = fade(fx);
  const v = fade(fz);
  const n00 = grad(seed, x0, z0, fx, fz);
  const n10 = grad(seed, x0 + 1, z0, fx - 1, fz);
  const n01 = grad(seed, x0, z0 + 1, fx, fz - 1);
  const n11 = grad(seed, x0 + 1, z0 + 1, fx - 1, fz - 1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 1.4142;
}

/** Fractal Brownian motion: layered octaves for natural-looking detail. */
export function fbm(seed: number, x: number, z: number, octaves = 4, lacunarity = 2.02, gain = 0.5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(seed + i * 1013, x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged noise: sharp mountain crests, used for mountain ranges. */
export function ridged(seed: number, x: number, z: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(seed + i * 709, x * freq, z * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}
