/**
 * Deterministic hashing and seeded randomness.
 * Everything in the world is a pure function of (seed, integer coordinates),
 * so the same seed always regenerates the same world.
 */

/** 32-bit integer hash of up to 4 integers. */
export function hashInts(seed: number, a: number, b = 0, c = 0): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(a | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  h ^= Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1);
  h ^= Math.imul(c | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae3d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Uniform float in [0,1) from integer inputs. */
export function hashFloat(seed: number, a: number, b = 0, c = 0): number {
  return hashInts(seed, a, b, c) / 4294967296;
}

/** Small seeded PRNG (mulberry32) for sequential random draws. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

/** Create an RNG from a seed and some integer keys (e.g. chunk coordinates). */
export function rngFor(seed: number, a: number, b = 0, c = 0): Rng {
  return new Rng(hashInts(seed, a, b, c));
}
