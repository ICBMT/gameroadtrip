/**
 * Procedural road network.
 *
 * Nodes sit on a jittered lattice (one per cell, position from the seed).
 * Each lattice edge (east or south of a node) may exist and is generated as a
 * smooth cubic curve between its two nodes. Some rows and columns of the lattice
 * are designated highways, giving the world long through-routes. Road class is
 * chosen from the urban density at the edge midpoint, so roads naturally
 * become city grids near city cores and rural lanes in the countryside.
 *
 * Every segment is a pure function of (seed, i, j, dir), so any chunk that
 * asks for a road gets exactly the same geometry as its neighbours.
 */
import { hashFloat, hashInts } from '../utils/random';
import { baseHeight } from '../terrain/heightfield';
import { urbanAt } from '../biomes/urban';
import { WORLD } from '../world/config';

export type RoadClass = 'highway' | 'city' | 'town' | 'rural';

export interface RoadStyle {
  halfWidth: number;
  lanes: number;
  speedKph: number;
}

export const ROAD_STYLE: Record<RoadClass, RoadStyle> = {
  highway: { halfWidth: 7, lanes: 4, speedKph: 110 },
  city: { halfWidth: 5, lanes: 2, speedKph: 50 },
  town: { halfWidth: 4, lanes: 2, speedKph: 60 },
  rural: { halfWidth: 3.25, lanes: 2, speedKph: 80 },
};

export interface RoadSegment {
  /** Unique id (stable across the world). */
  id: number;
  cls: RoadClass;
  style: RoadStyle;
  /** Polyline points, interleaved x,z (world metres). */
  pts: Float64Array;
  /** Road surface height at each point (metres). */
  elev: Float64Array;
  /** Arc length from the start to each point. */
  cum: Float64Array;
  length: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Lattice coordinates of the start node and direction (0 = east, 1 = south). */
  i: number;
  j: number;
  dir: number;
  /** Start and end node positions (intersections). */
  startNode: [number, number];
  endNode: [number, number];
}

const G = WORLD.ROAD_CELL;
const cache = new Map<string, RoadSegment | null>();
const CACHE_LIMIT = 20000;

/** Position of lattice node (i, j). Nodes stay in the middle half of their cell. */
export function nodeXZ(seed: number, i: number, j: number): [number, number] {
  const hx = hashFloat(seed, i, j, 1);
  const hz = hashFloat(seed, i, j, 2);
  return [(i + 0.25 + 0.5 * hx) * G, (j + 0.25 + 0.5 * hz) * G];
}

/** Whether lattice row j (for east edges) or column i (for south edges) is a highway. */
export function isHighwayLine(seed: number, index: number, dir: number): boolean {
  return hashInts(seed, index, dir === 0 ? 0x51 : 0x52) % 6 === 0;
}

function rotate(x: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}

function boxSmooth(src: Float64Array, radius: number, passes: number): Float64Array {
  let cur = src;
  const n = src.length;
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let sum = 0;
      let cnt = 0;
      const lo = Math.max(0, k - radius);
      const hi = Math.min(n - 1, k + radius);
      for (let q = lo; q <= hi; q++) {
        sum += cur[q];
        cnt++;
      }
      out[k] = sum / cnt;
    }
    cur = out;
  }
  return cur;
}

function buildSegment(seed: number, i: number, j: number, dir: number): RoadSegment | null {
  const [ax, az] = nodeXZ(seed, i, j);
  const [bx, bz] = dir === 0 ? nodeXZ(seed, i + 1, j) : nodeXZ(seed, i, j + 1);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const urban = urbanAt(seed, mx, mz).density;
  const hw = isHighwayLine(seed, dir === 0 ? j : i, dir);
  const present = hw || urban > 0.3 || hashFloat(seed, i, j, 20 + dir) < 0.8;
  if (!present) return null;

  const cls: RoadClass = hw ? 'highway' : urban > 0.45 ? 'city' : urban > 0.15 ? 'town' : 'rural';
  const style = ROAD_STYLE[cls];

  const dx = bx - ax;
  const dz = bz - az;
  const chord = Math.hypot(dx, dz);
  const ux = dx / chord;
  const uz = dz / chord;
  // Bend amount: straight in cities and on highways, winding in the countryside.
  const bend = cls === 'city' ? 0.05 : cls === 'highway' ? 0.18 : cls === 'town' ? 0.3 : 0.55;
  const angA = (hashFloat(seed, i, j, 30 + dir) * 2 - 1) * bend;
  const angB = (hashFloat(seed, i, j, 40 + dir) * 2 - 1) * bend;
  const [tAx, tAz] = rotate(ux, uz, angA);
  const [tBx, tBz] = rotate(ux, uz, angB);
  const c1x = ax + tAx * chord * 0.35;
  const c1z = az + tAz * chord * 0.35;
  const c2x = bx - tBx * chord * 0.35;
  const c2z = bz - tBz * chord * 0.35;

  // Sample the curve densely, then resample by arc length so points are evenly spaced.
  const dense = Math.max(8, Math.ceil(chord / (WORLD.ROAD_STEP / 4)));
  const dx2 = new Float64Array(dense + 1);
  const dz2 = new Float64Array(dense + 1);
  const dcum = new Float64Array(dense + 1);
  for (let k = 0; k <= dense; k++) {
    const t = k / dense;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    dx2[k] = b0 * ax + b1 * c1x + b2 * c2x + b3 * bx;
    dz2[k] = b0 * az + b1 * c1z + b2 * c2z + b3 * bz;
    if (k > 0) dcum[k] = dcum[k - 1] + Math.hypot(dx2[k] - dx2[k - 1], dz2[k] - dz2[k - 1]);
  }
  const total = dcum[dense];
  const n = Math.max(2, Math.ceil(total / WORLD.ROAD_STEP));
  const pts = new Float64Array((n + 1) * 2);
  let q = 0;
  for (let k = 0; k <= n; k++) {
    const target = k === n ? total : (k * total) / n;
    while (q < dense - 1 && dcum[q + 1] < target) q++;
    const span = dcum[q + 1] - dcum[q] || 1e-9;
    const f = Math.min(1, Math.max(0, (target - dcum[q]) / span));
    pts[2 * k] = dx2[q] + (dx2[q + 1] - dx2[q]) * f;
    pts[2 * k + 1] = dz2[q] + (dz2[q + 1] - dz2[q]) * f;
  }
  pts[0] = ax;
  pts[1] = az;
  pts[2 * n] = bx;
  pts[2 * n + 1] = bz;

  const cum = new Float64Array(n + 1);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k <= n; k++) {
    const x = pts[2 * k];
    const z = pts[2 * k + 1];
    if (k > 0) cum[k] = cum[k - 1] + Math.hypot(x - pts[2 * k - 2], z - pts[2 * k - 1]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  // Road surface: smoothed terrain under the road, pinned exactly to the node
  // heights at both ends so neighbouring segments meet without steps.
  const raw = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) raw[k] = baseHeight(seed, pts[2 * k], pts[2 * k + 1]);
  const radius = cls === 'highway' ? 12 : 6;
  const smooth = boxSmooth(raw, radius, 2);
  const pinA = baseHeight(seed, ax, az);
  const pinB = baseHeight(seed, bx, bz);
  const elev = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const e = smooth[k] + (pinA - smooth[0]) * (1 - t) + (pinB - smooth[n]) * t;
    elev[k] = Math.max(e, WORLD.SEA_LEVEL + 0.6);
  }

  const margin = style.halfWidth + 2;
  return {
    id: hashInts(seed, i, j, dir) >>> 0,
    cls,
    style,
    pts,
    elev,
    cum,
    length: cum[n],
    minX: minX - margin,
    minZ: minZ - margin,
    maxX: maxX + margin,
    maxZ: maxZ + margin,
    i,
    j,
    dir,
    startNode: [ax, az],
    endNode: [bx, bz],
  };
}

/** Cached access to a single lattice edge (null if absent). */
export function getSegment(seed: number, i: number, j: number, dir: number): RoadSegment | null {
  const key = `${seed}:${i}:${j}:${dir}`;
  let seg = cache.get(key);
  if (seg === undefined) {
    if (cache.size > CACHE_LIMIT) cache.clear();
    seg = buildSegment(seed, i, j, dir);
    cache.set(key, seg);
  }
  return seg;
}

/** All road segments whose bounding box overlaps the given world rectangle. */
export function roadsInRect(
  seed: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): RoadSegment[] {
  const out: RoadSegment[] = [];
  const i0 = Math.floor(minX / G) - 2;
  const i1 = Math.floor(maxX / G) + 1;
  const j0 = Math.floor(minZ / G) - 2;
  const j1 = Math.floor(maxZ / G) + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (let dir = 0; dir < 2; dir++) {
        const s = getSegment(seed, i, j, dir);
        if (!s) continue;
        if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ) continue;
        out.push(s);
      }
    }
  }
  return out;
}

export interface RoadHit {
  /** Closest point on the road centreline. */
  x: number;
  z: number;
  dist: number;
  elev: number;
  cls: RoadClass;
  halfWidth: number;
  segId: number;
  /** Arc-length position along the segment. */
  s: number;
  /** Unit tangent of the road at the hit point. */
  dirX: number;
  dirZ: number;
}

/** Closest point on any road in the list to (x, z), or null if none within maxDist. */
export function nearestRoad(segs: readonly RoadSegment[], x: number, z: number, maxDist: number): RoadHit | null {
  let best: RoadHit | null = null;
  let bestD = maxDist;
  for (const seg of segs) {
    if (x < seg.minX - maxDist || x > seg.maxX + maxDist || z < seg.minZ - maxDist || z > seg.maxZ + maxDist) continue;
    const p = seg.pts;
    const n = p.length / 2 - 1;
    for (let k = 0; k < n; k++) {
      const ax = p[2 * k];
      const az = p[2 * k + 1];
      const bx = p[2 * k + 2];
      const bz = p[2 * k + 3];
      const vx = bx - ax;
      const vz = bz - az;
      const len2 = vx * vx + vz * vz || 1e-9;
      let t = ((x - ax) * vx + (z - az) * vz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + vx * t;
      const qz = az + vz * t;
      const d = Math.hypot(x - qx, z - qz);
      if (d < bestD) {
        bestD = d;
        const len = Math.sqrt(len2);
        best = {
          x: qx,
          z: qz,
          dist: d,
          elev: seg.elev[k] + (seg.elev[k + 1] - seg.elev[k]) * t,
          cls: seg.cls,
          halfWidth: seg.style.halfWidth,
          segId: seg.id,
          s: seg.cum[k] + (seg.cum[k + 1] - seg.cum[k]) * t,
          dirX: vx / len,
          dirZ: vz / len,
        };
      }
    }
  }
  return best;
}

/**
 * A good place to start: the first highway node near the origin, heading east.
 * Returns position, heading (radians, 0 = +z, matching Three.js yaw convention used by the car)
 * and the road's elevation.
 */
export function findSpawn(seed: number): { x: number; z: number; heading: number } {
  for (let k = 0; k < 200; k++) {
    const j = k % 2 === 0 ? k / 2 : -(k + 1) / 2;
    if (!isHighwayLine(seed, j, 0)) continue;
    const seg = getSegment(seed, 0, j, 0);
    if (!seg) continue;
    const idx = Math.floor(seg.pts.length / 4); // a point near the middle of the segment
    const x = seg.pts[2 * idx];
    const z = seg.pts[2 * idx + 1];
    const nx = seg.pts[2 * idx + 2];
    const nz = seg.pts[2 * idx + 3];
    // Car forward vector is (sin(heading), cos(heading)) in x,z.
    const heading = Math.atan2(nx - x, nz - z);
    return { x, z, heading };
  }
  return { x: 0, z: 0, heading: 0 };
}
