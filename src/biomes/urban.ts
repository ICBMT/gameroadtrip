/**
 * Urban density field. Cities are placed on a coarse lattice of "city cells":
 * each cell may contain one city whose position, size and character come from
 * the world seed. Density falls off smoothly from the city centre outwards, so
 * suburbs and towns form natural rings around each core.
 */
import { hashFloat, hashInts } from '../utils/random';
import { smoothstep } from '../utils/math';

export const CITY_CELL = 3200;

export interface CityInfo {
  id: number; // stable identifier for exploration stats
  x: number;
  z: number;
  radius: number; // outer edge of the city (metres)
  size: number; // 0..1 relative size
}

export interface UrbanSample {
  density: number; // 0 = countryside, 1 = downtown core
  city: CityInfo | null;
  /** Distance from the nearest city centre, normalised by its radius (0 at centre). */
  norm: number;
}

/** Deterministic city in a lattice cell, or null if none. */
export function cityInCell(seed: number, ci: number, cj: number): CityInfo | null {
  if (hashFloat(seed, ci, cj, 11) > 0.42) return null;
  const jx = hashFloat(seed, ci, cj, 12);
  const jz = hashFloat(seed, ci, cj, 13);
  const size = 0.3 + 0.7 * hashFloat(seed, ci, cj, 14);
  return {
    id: hashInts(seed, ci, cj, 15),
    x: ci * CITY_CELL + (0.2 + 0.6 * jx) * CITY_CELL,
    z: cj * CITY_CELL + (0.2 + 0.6 * jz) * CITY_CELL,
    radius: 700 + 1300 * size,
    size,
  };
}

export function urbanAt(seed: number, x: number, z: number): UrbanSample {
  const ci0 = Math.floor(x / CITY_CELL);
  const cj0 = Math.floor(z / CITY_CELL);
  let best = 0;
  let bestCity: CityInfo | null = null;
  let bestNorm = Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const city = cityInCell(seed, ci0 + di, cj0 + dj);
      if (!city) continue;
      const d = Math.hypot(x - city.x, z - city.z);
      const norm = d / city.radius;
      // Core is dense, ring of suburbs fades out at the edge.
      const dens = (1 - smoothstep(0.15, 1.0, norm)) * (0.55 + 0.45 * city.size);
      if (dens > best) {
        best = dens;
        bestCity = city;
        bestNorm = norm;
      }
    }
  }
  return { density: Math.min(1, best), city: bestCity, norm: bestNorm };
}
