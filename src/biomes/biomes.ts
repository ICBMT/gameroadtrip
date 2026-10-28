/**
 * Biome classification. Biomes are soft: the classifier returns the dominant
 * biome at a point, and the terrain colour and vegetation density are blended
 * between neighbours so transitions are gradual rather than hard edges.
 */
import { baseHeight } from '../terrain/heightfield';
import { fbm } from '../terrain/noise';
import { urbanAt } from './urban';
import { hashFloat } from '../utils/random';
import { WORLD } from '../world/config';

export type BiomeName =
  | 'Ocean'
  | 'Coast'
  | 'Forest'
  | 'Countryside'
  | 'Village'
  | 'Mountain'
  | 'Town'
  | 'Suburban'
  | 'City'
  | 'Downtown';

export const BIOME_LABEL: Record<BiomeName, string> = {
  Ocean: 'Ocean',
  Coast: 'Coast',
  Forest: 'Forest',
  Countryside: 'Countryside',
  Village: 'Village',
  Mountain: 'Mountain',
  Town: 'Town',
  Suburban: 'Suburbs',
  City: 'City',
  Downtown: 'Downtown',
};

/** Moisture field: decides forest vs open countryside. */
export function moistureAt(seed: number, x: number, z: number): number {
  return fbm(seed + 300, x / 700, z / 700, 3);
}

/** Villages are small clusters placed on a 420 m lattice. */
export function villageAt(seed: number, x: number, z: number): boolean {
  const C = 420;
  const ci = Math.floor(x / C);
  const cj = Math.floor(z / C);
  if (hashFloat(seed, ci, cj, 60) > 0.3) return false;
  const cx = (ci + 0.3 + 0.4 * hashFloat(seed, ci, cj, 61)) * C;
  const cz = (cj + 0.3 + 0.4 * hashFloat(seed, ci, cj, 62)) * C;
  return Math.hypot(x - cx, z - cz) < 130;
}

export function biomeAt(seed: number, x: number, z: number, height?: number): BiomeName {
  const h = height ?? baseHeight(seed, x, z);
  if (h < WORLD.SEA_LEVEL - 1) return 'Ocean';
  if (h < WORLD.SEA_LEVEL + 2.5) return 'Coast';
  const urban = urbanAt(seed, x, z).density;
  if (urban > 0.72) return 'Downtown';
  if (urban > 0.48) return 'City';
  if (urban > 0.26) return 'Suburban';
  if (urban > 0.1) return 'Town';
  if (h > 120) return 'Mountain';
  if (villageAt(seed, x, z)) return 'Village';
  return moistureAt(seed, x, z) > 0 ? 'Forest' : 'Countryside';
}
