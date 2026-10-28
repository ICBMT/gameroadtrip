/**
 * Pure chunk generator: given (seed, cx, cz) it returns all the data needed to
 * render that 200 m square of the world. It has no side effects and no
 * dependency on the renderer, so it runs identically on the main thread, in a
 * Web Worker, and under Node tests.
 *
 * Ownership rules keep everything consistent across chunk borders:
 *  - Trees live on a global 10 m lattice; a tree belongs to the chunk containing it.
 *  - Buildings live on a global 24 m lot lattice; a lot belongs to the chunk
 *    containing its centre.
 *  - Roads are global polylines; each chunk emits the parts near it.
 */
import { WORLD } from './config';
import type { ChunkData, InstanceData, MeshData } from './chunkTypes';
import { baseHeight } from '../terrain/heightfield';
import { roadsInRect, nearestRoad, type RoadClass, type RoadSegment } from '../roads/roadGraph';
import { urbanAt, cityInCell, CITY_CELL } from '../biomes/urban';
import { biomeAt, type BiomeName } from '../biomes/biomes';
import { hashFloat } from '../utils/random';
import { smoothstep, lerp } from '../utils/math';

const S = WORLD.CHUNK_SIZE;
const R = WORLD.CHUNK_RES;
const CELL = S / R;
const ROAD_QUERY_MARGIN = 60;
const TREE_CELL = 10;
const LOT = 24;
/** Road surface sits this far above the road's terrain height (metres). */
export const ROAD_LIFT = 0.12;

/** Road surface height at a point: terrain blended to the nearby road where close to it. */
export function surfaceHeight(seed: number, x: number, z: number, segs: readonly RoadSegment[]): number {
  const base = baseHeight(seed, x, z);
  const hit = nearestRoad(segs, x, z, 30);
  if (!hit) return base;
  const w = 1 - smoothstep(hit.halfWidth, hit.halfWidth + 10, hit.dist);
  return lerp(base, hit.elev, w);
}

function slopeAt(seed: number, x: number, z: number): number {
  const d = 2.5;
  const dhx = (baseHeight(seed, x + d, z) - baseHeight(seed, x - d, z)) / (2 * d);
  const dhz = (baseHeight(seed, x, z + d) - baseHeight(seed, x, z - d)) / (2 * d);
  return Math.hypot(dhx, dhz);
}

// ---------- colours ----------

const BIOME_GROUND: Record<BiomeName, [number, number, number]> = {
  Ocean: [0.12, 0.3, 0.36],
  Coast: [0.5, 0.6, 0.36],
  Forest: [0.17, 0.35, 0.14],
  Countryside: [0.46, 0.6, 0.27],
  Village: [0.42, 0.56, 0.28],
  Mountain: [0.4, 0.4, 0.32],
  Town: [0.37, 0.5, 0.26],
  Suburban: [0.36, 0.52, 0.25],
  City: [0.44, 0.44, 0.45],
  Downtown: [0.42, 0.42, 0.44],
};
const ROCK: [number, number, number] = [0.42, 0.39, 0.36];
const SAND: [number, number, number] = [0.82, 0.76, 0.56];
const SNOW: [number, number, number] = [0.93, 0.94, 0.96];

function mix(out: number[], a: [number, number, number], b: [number, number, number], t: number) {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
}

// ---------- mesh builders ----------

class MeshBuilder {
  pos: number[] = [];
  idx: number[] = [];
  v(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  toMesh(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      indices: new Uint32Array(this.idx),
    };
  }
}

/**
 * Emit a ribbon along a road segment. Lateral centre offset `c`, half width `hw`.
 * Only quads for which `keep(k)` is true are emitted. Winding faces +Y.
 */
function emitRibbon(
  mb: MeshBuilder,
  seg: RoadSegment,
  c: number,
  hw: number,
  lift: number,
  keep: (k: number) => boolean,
) {
  const p = seg.pts;
  const n = p.length / 2 - 1;
  const L: number[] = new Array(n + 1).fill(-1);
  const Rv: number[] = new Array(n + 1).fill(-1);
  const vert = (k: number, side: 1 | -1): number => {
    const arr = side === 1 ? L : Rv;
    if (arr[k] >= 0) return arr[k];
    const k0 = Math.max(0, k - 1);
    const k1 = Math.min(n, k + 1);
    let tx = p[2 * k1] - p[2 * k0];
    let tz = p[2 * k1 + 1] - p[2 * k0 + 1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Left normal in the x/z plane: (-tz, tx)
    const off = c + side * hw;
    const x = p[2 * k] - tz * off;
    const z = p[2 * k + 1] + tx * off;
    arr[k] = mb.v(x, seg.elev[k] + lift, z);
    return arr[k];
  };
  // Note: the ribbon's "left" vertex (side=+1) is at x - tz*off. Quads are built below.
  for (let k = 0; k < n; k++) {
    if (!keep(k)) continue;
    const a = vert(k, 1);
    const b = vert(k + 1, 1);
    const cc = vert(k, -1);
    const d = vert(k + 1, -1);
    // Triangles wind so that the normal points up (verified for travel along +z).
    mb.tri(a, b, cc);
    mb.tri(b, d, cc);
  }
}

function emptyInstances(): { matrices: number[]; colors: number[] } {
  return { matrices: [], colors: [] };
}

function finishInstances(a: { matrices: number[]; colors: number[] }): InstanceData {
  return {
    matrices: new Float32Array(a.matrices),
    colors: new Float32Array(a.colors),
    count: a.colors.length / 3,
  };
}

/** Column-major matrix: rotation about Y, then per-axis scale, then translation. */
function pushMatrix(out: number[], x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1);
}

// ---------- main entry ----------

export function generateChunk(seed: number, cx: number, cz: number): ChunkData {
  const ox = cx * S;
  const oz = cz * S;
  const segs = roadsInRect(seed, ox - ROAD_QUERY_MARGIN, oz - ROAD_QUERY_MARGIN, ox + S + ROAD_QUERY_MARGIN, oz + S + ROAD_QUERY_MARGIN);

  // ----- terrain -----
  const N = R + 1;
  const heights = new Float32Array(N * N);
  const colors = new Float32Array(N * N * 3);
  const tmp = [0, 0, 0];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ox + i * CELL;
      const z = oz + j * CELL;
      const base = baseHeight(seed, x, z);
      const hit = nearestRoad(segs, x, z, 30);
      let h = base;
      if (hit) {
        const w = 1 - smoothstep(hit.halfWidth, hit.halfWidth + 10, hit.dist);
        h = lerp(base, hit.elev, w);
      }
      heights[j * N + i] = h;

      // Colour
      const biome = biomeAt(seed, x, z, base);
      const slope = slopeAt(seed, x, z);
      const idx = (j * N + i) * 3;
      if (h < WORLD.SEA_LEVEL - 1) {
        mix(tmp, BIOME_GROUND.Ocean, BIOME_GROUND.Ocean, 0);
      } else {
        let ground = BIOME_GROUND[biome];
        // Countryside fields: patchwork of cell-based tints.
        if (biome === 'Countryside' || biome === 'Village') {
          const fi = Math.floor(x / 60);
          const fj = Math.floor(z / 60);
          const t = hashFloat(seed, fi, fj, 90);
          const field: [number, number, number] = t < 0.33 ? [0.6, 0.58, 0.3] : t < 0.66 ? [0.4, 0.6, 0.25] : [0.5, 0.52, 0.27];
          mix(tmp, ground, field, 0.55);
          ground = [tmp[0], tmp[1], tmp[2]];
        }
        mix(tmp, ground, ROCK, smoothstep(0.55, 0.95, slope) + smoothstep(170, 230, h) * 0.5);
        if (h > 230) mix(tmp, [tmp[0], tmp[1], tmp[2]], SNOW, smoothstep(230, 270, h));
        if (h < WORLD.SEA_LEVEL + 2.5) mix(tmp, [tmp[0], tmp[1], tmp[2]], SAND, 1 - smoothstep(WORLD.SEA_LEVEL + 0.5, WORLD.SEA_LEVEL + 2.5, h));
      }
      colors[idx] = tmp[0];
      colors[idx + 1] = tmp[1];
      colors[idx + 2] = tmp[2];
    }
  }

  // ----- roads -----
  const roadBuilders: Record<RoadClass, MeshBuilder> = {
    highway: new MeshBuilder(),
    city: new MeshBuilder(),
    town: new MeshBuilder(),
    rural: new MeshBuilder(),
  };
  const marks = new MeshBuilder();
  const inChunk = (x: number, z: number, m: number) => x >= ox - m && x <= ox + S + m && z >= oz - m && z <= oz + S + m;
  for (const seg of segs) {
    const n = seg.pts.length / 2 - 1;
    const near = (k: number) => {
      const a = inChunk(seg.pts[2 * k], seg.pts[2 * k + 1], 4);
      const b = k + 1 <= n && inChunk(seg.pts[2 * k + 2], seg.pts[2 * k + 3], 4);
      return a || b;
    };
    emitRibbon(roadBuilders[seg.cls], seg, 0, seg.style.halfWidth, ROAD_LIFT, near);
    // Lane paint: dashed centre line on paved roads, solid edge lines on highways.
    if (seg.cls !== 'rural') {
      emitRibbon(marks, seg, 0, 0.12, 0.2, (k) => near(k) && (seg.cum[k] + seg.cum[k + 1]) / 2 % 9 < 4.5);
    }
    if (seg.cls === 'highway') {
      const edge = seg.style.halfWidth - 0.5;
      emitRibbon(marks, seg, edge, 0.1, 0.2, near);
      emitRibbon(marks, seg, -edge, 0.1, 0.2, near);
    }
  }
  const roads = {
    highway: roadBuilders.highway.toMesh(),
    city: roadBuilders.city.toMesh(),
    town: roadBuilders.town.toMesh(),
    rural: roadBuilders.rural.toMesh(),
  };

  // ----- vegetation & buildings (global lattices, owned by position) -----
  const conifers = emptyInstances();
  const broadleaves = emptyInstances();
  const bodies = emptyInstances();
  const roofs = emptyInstances();

  // Buildings first so trees can avoid them.
  const footprints: { x: number; z: number; hx: number; hz: number }[] = [];
  const li0 = Math.floor(ox / LOT);
  const li1 = Math.floor((ox + S) / LOT);
  const lj0 = Math.floor(oz / LOT);
  const lj1 = Math.floor((oz + S) / LOT);
  for (let lj = lj0; lj <= lj1; lj++) {
    for (let li = li0; li <= li1; li++) {
      const cxw = (li + 0.5) * LOT + (hashFloat(seed, li, lj, 100) - 0.5) * 4;
      const czw = (lj + 0.5) * LOT + (hashFloat(seed, li, lj, 101) - 0.5) * 4;
      if (Math.floor(cxw / S) !== cx || Math.floor(czw / S) !== cz) continue;
      const urban = urbanAt(seed, cxw, czw).density;
      const base = baseHeight(seed, cxw, czw);
      if (base < WORLD.SEA_LEVEL + 1.5) continue;
      const biome = biomeAt(seed, cxw, czw, base);
      const roll = hashFloat(seed, li, lj, 102);
      const chance: Record<BiomeName, number> = {
        Ocean: 0, Coast: 0.04, Forest: 0, Countryside: 0.05, Village: 0.4, Mountain: 0.01,
        Town: 0.6, Suburban: 0.75, City: 0.88, Downtown: 0.95,
      };
      if (roll > chance[biome]) continue;
      if (slopeAt(seed, cxw, czw) > 0.22 && biome !== 'Downtown') continue;

      const kind = hashFloat(seed, li, lj, 103);
      const hitR = nearestRoad(segs, cxw, czw, 60);
      const sizeA = 8 + 10 * hashFloat(seed, li, lj, 104);
      const sizeB = 8 + 10 * hashFloat(seed, li, lj, 105);
      const isDowntown = biome === 'Downtown' || biome === 'City';
      let hx = sizeA / 2;
      let hz = sizeB / 2;
      if (isDowntown) {
        hx = 6 + 6 * hashFloat(seed, li, lj, 104);
        hz = 6 + 6 * hashFloat(seed, li, lj, 105);
      }
      const radius = Math.hypot(hx, hz);
      if (hitR && hitR.dist < hitR.halfWidth + radius + 1.5) continue;

      const y = surfaceHeight(seed, cxw, czw, segs) - 0.3;
      const lx = cxw - ox;
      const lz = czw - oz;
      const tint = hashFloat(seed, li, lj, 106);
      const yaw = 0; // lots are axis-aligned
      footprints.push({ x: cxw, z: czw, hx, hz });

      if (isDowntown && urban > 0.4) {
        // Skyscrapers and office blocks
        const h2 = (isDowntown && biome === 'Downtown' ? 40 + 130 * Math.pow(kind, 1.6) : 14 + 36 * kind);
        pushMatrix(bodies.matrices, lx, y, lz, yaw, hx * 2, h2, hz * 2);
        const g = tint > 0.5 ? [0.55 + 0.1 * tint, 0.62, 0.7] : [0.48, 0.5, 0.52];
        bodies.colors.push(g[0], g[1], g[2]);
      } else if (biome === 'Town' || biome === 'City' || biome === 'Suburban' && kind < 0.4) {
        const h2 = 7 + 12 * kind;
        pushMatrix(bodies.matrices, lx, y, lz, yaw, hx * 2, h2, hz * 2);
        const pal = [[0.78, 0.7, 0.6], [0.6, 0.35, 0.28], [0.85, 0.84, 0.8], [0.55, 0.6, 0.66]];
        const c = pal[Math.floor(tint * pal.length)];
        bodies.colors.push(c[0], c[1], c[2]);
      } else {
        // Houses with gable roofs: suburbs, villages and farms.
        const wallH = biome === 'Countryside' || biome === 'Village' ? 4 + 2 * kind : 4.5 + 1.5 * kind;
        const hw2 = 4 + 2 * hashFloat(seed, li, lj, 108);
        const hd2 = 4.5 + 2.5 * hashFloat(seed, li, lj, 109);
        footprints[footprints.length - 1] = { x: cxw, z: czw, hx: hw2, hz: hd2 };
        pushMatrix(bodies.matrices, lx, y, lz, yaw, hw2 * 2, wallH, hd2 * 2);
        const pal = [[0.92, 0.9, 0.84], [0.8, 0.6, 0.45], [0.7, 0.8, 0.85], [0.95, 0.85, 0.6]];
        const c = pal[Math.floor(tint * pal.length)];
        bodies.colors.push(c[0], c[1], c[2]);
        // Roof is a prism: ridge runs along x.
        pushMatrix(roofs.matrices, lx, y + wallH, lz, yaw, hw2 * 2, 2.6, hd2 * 2);
        const rc = [0.42, 0.22, 0.2];
        roofs.colors.push(rc[0], rc[1], rc[2]);
      }
    }
  }

  // Trees on a 10 m lattice.
  const ti0 = Math.floor(ox / TREE_CELL);
  const ti1 = Math.floor((ox + S) / TREE_CELL);
  const tj0 = Math.floor(oz / TREE_CELL);
  const tj1 = Math.floor((oz + S) / TREE_CELL);
  const TREE_CHANCE: Record<BiomeName, number> = {
    Ocean: 0, Coast: 0.05, Forest: 0.7, Countryside: 0.08, Village: 0.2, Mountain: 0.3,
    Town: 0.1, Suburban: 0.45, City: 0.04, Downtown: 0.01,
  };
  for (let tj = tj0; tj <= tj1; tj++) {
    for (let ti = ti0; ti <= ti1; ti++) {
      const px = (ti + 0.05 + 0.9 * hashFloat(seed, ti, tj, 200)) * TREE_CELL;
      const pz = (tj + 0.05 + 0.9 * hashFloat(seed, ti, tj, 201)) * TREE_CELL;
      if (Math.floor(px / S) !== cx || Math.floor(pz / S) !== cz) continue;
      const base = baseHeight(seed, px, pz);
      if (base < WORLD.SEA_LEVEL + 0.8) continue;
      const biome = biomeAt(seed, px, pz, base);
      const chance = TREE_CHANCE[biome];
      if (biome === 'Mountain' && base > 200) continue;
      if (hashFloat(seed, ti, tj, 202) > chance) continue;
      const slope = slopeAt(seed, px, pz);
      if (slope > 0.9) continue;
      const hit = nearestRoad(segs, px, pz, 20);
      if (hit && hit.dist < hit.halfWidth + 3.5) continue;
      let blocked = false;
      for (const f of footprints) {
        if (Math.abs(f.x - px) < f.hx + 3 && Math.abs(f.z - pz) < f.hz + 3) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const y = surfaceHeight(seed, px, pz, segs);
      const sc = 0.8 + 0.7 * hashFloat(seed, ti, tj, 203);
      const yaw = hashFloat(seed, ti, tj, 204) * Math.PI * 2;
      const conifer = biome === 'Mountain' || (biome === 'Forest' && base > 80) || hashFloat(seed, ti, tj, 205) < 0.25;
      const target = conifer ? conifers : broadleaves;
      pushMatrix(target.matrices, px - ox, y, pz - oz, yaw, sc, sc * (conifer ? 1.3 : 1), sc);
      const shade = 0.85 + 0.3 * hashFloat(seed, ti, tj, 206);
      target.colors.push(shade * (conifer ? 0.2 : 0.3), shade * (conifer ? 0.38 : 0.5), shade * (conifer ? 0.2 : 0.18));
    }
  }

  // ----- city references (for exploration stats) -----
  const cityIds: number[] = [];
  const ci0 = Math.floor((ox - 1500) / CITY_CELL);
  const ci1 = Math.floor((ox + S + 1500) / CITY_CELL);
  const cj0 = Math.floor((oz - 1500) / CITY_CELL);
  const cj1 = Math.floor((oz + S + 1500) / CITY_CELL);
  for (let cj = cj0; cj <= cj1; cj++) {
    for (let ci = ci0; ci <= ci1; ci++) {
      const city = cityInCell(seed, ci, cj);
      if (!city) continue;
      if (city.x >= ox && city.x < ox + S && city.z >= oz && city.z < oz + S) cityIds.push(city.id);
    }
  }

  const centre = biomeAt(seed, ox + S / 2, oz + S / 2);

  return {
    cx,
    cz,
    heights,
    colors,
    roads,
    markings: marks.toMesh(),
    conifers: finishInstances(conifers),
    broadleaves: finishInstances(broadleaves),
    bodies: finishInstances(bodies),
    roofs: finishInstances(roofs),
    cityIds,
    biomeHint: centre,
  };
}

/** Terrain grid info, shared with the renderer. */
export const TERRAIN_GRID = { N: R + 1, CELL, SIZE: S };

