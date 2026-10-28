/**
 * Base terrain height. Pure function of (seed, x, z): the same point always
 * yields the same height, which is what keeps chunk edges seamless and makes
 * revisited areas identical.
 */
import { fbm, ridged } from './noise';
import { smoothstep, clamp } from '../utils/math';

/** Metres above sea level. Negative values are underwater. */
export function baseHeight(seed: number, x: number, z: number): number {
  // Continental shape: large lobes of land and sea.
  const continent = fbm(seed, x / 2600, z / 2600, 3);
  const land = smoothstep(-0.3, 0.05, continent + 0.15);
  // Rolling hills everywhere.
  const hills = fbm(seed + 17, x / 320, z / 320, 4);
  // Mountain ranges appear where a separate mask is high.
  const mask = smoothstep(0.02, 0.3, fbm(seed + 91, x / 1700, z / 1700, 3));
  const peaks = ridged(seed + 53, x / 900, z / 900, 4);

  const lowland = (continent + 0.05) * 70 + hills * 14 + 6;
  const mountains = mask * Math.pow(peaks, 1.4) * 330 * (0.4 + 0.6 * land);
  const h = lowland * (0.35 + 0.65 * land) + mountains;
  return clamp(h, -40, 900);
}
