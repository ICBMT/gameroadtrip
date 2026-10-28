/**
 * Turns ChunkData into Three.js objects. Shared geometry and materials are created
 * once; each chunk only owns its terrain geometry and instanced-mesh buffers.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChunkData, InstanceData, MeshData } from '../world/chunkTypes';
import { WORLD } from '../world/config';
import type { RoadClass } from '../roads/roadGraph';

const S = WORLD.CHUNK_SIZE;
const R = WORLD.CHUNK_RES;
const CELL = S / R;

export interface SharedAssets {
  materials: {
    terrain: THREE.Material;
    road: Record<RoadClass, THREE.Material>;
    marking: THREE.Material;
    tree: THREE.Material;
    body: THREE.Material;
    roof: THREE.Material;
  };
  geometry: {
    conifer: THREE.BufferGeometry;
    broadleaf: THREE.BufferGeometry;
    box: THREE.BufferGeometry;
    prism: THREE.BufferGeometry;
  };
}

function coniferGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6).toNonIndexed();
  trunk.translate(0, 0.8, 0);
  paint(trunk, [0.35, 0.24, 0.14]);
  const crown = new THREE.ConeGeometry(1.7, 5.4, 8).toNonIndexed();
  crown.translate(0, 4.3, 0);
  paint(crown, [1, 1, 1]);
  return mergeParts([trunk, crown]);
}

function broadleafGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2, 6).toNonIndexed();
  trunk.translate(0, 1, 0);
  paint(trunk, [0.38, 0.27, 0.16]);
  const crown = new THREE.IcosahedronGeometry(2.6, 1).toNonIndexed();
  crown.translate(0, 4.2, 0);
  paint(crown, [1, 1, 1]);
  return mergeParts([trunk, crown]);
}

/** Merge non-indexed parts (all must share attributes). Throws if the merge fails. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('tree geometry merge failed');
  parts.forEach((p) => p.dispose());
  return g;
}

/** Adds a flat vertex colour attribute so merged geometries keep their own tints. */
function paint(g: THREE.BufferGeometry, rgb: [number, number, number]) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = rgb[0];
    c[i * 3 + 1] = rgb[1];
    c[i * 3 + 2] = rgb[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/** Gable roof prism: base 1x1 at y=0, ridge along x at y=1. Scaled per instance. */
function prismGeometry(): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => [x, y, z];
  const tris: number[][][] = [
    // slopes
    [v(-0.5, 0, -0.5), v(0.5, 0, -0.5), v(0.5, 1, 0), v(-0.5, 1, 0)],
    [v(-0.5, 0, 0.5), v(0.5, 0, 0.5), v(0.5, 1, 0), v(-0.5, 1, 0)],
  ];
  const pos: number[] = [];
  for (const quad of tris) {
    const [a, b, c, d] = quad;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  // gable ends
  pos.push(-0.5, 0, -0.5, -0.5, 1, 0, -0.5, 0, 0.5);
  pos.push(0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function createSharedAssets(): SharedAssets {
  const road = (color: number) =>
    new THREE.MeshLambertMaterial({
      color,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  return {
    materials: {
      terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
      road: {
        highway: road(0x2b2e33),
        city: road(0x383b40),
        town: road(0x4a4d52),
        rural: road(0x6b5f4c),
      },
      marking: new THREE.MeshLambertMaterial({
        color: 0xeeeeea,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
      tree: new THREE.MeshLambertMaterial({ vertexColors: true }),
      body: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      roof: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    },
    geometry: {
      conifer: coniferGeometry(),
      broadleaf: broadleafGeometry(),
      box: (() => {
        const b = new THREE.BoxGeometry(1, 1, 1);
        b.translate(0, 0.5, 0);
        return b;
      })(),
      prism: prismGeometry(),
    },
  };
}

function surfaceMesh(m: MeshData, mat: THREE.Material): THREE.Mesh | null {
  if (m.indices.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  const normals = new Float32Array(m.positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return new THREE.Mesh(g, mat);
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, inst: InstanceData): THREE.InstancedMesh | null {
  if (inst.count === 0) return null;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const m = new THREE.InstancedMesh(geo, mat, inst.count);
  (m.instanceMatrix.array as Float32Array).set(inst.matrices);
  m.instanceMatrix.needsUpdate = true;
  m.instanceColor = new THREE.InstancedBufferAttribute(inst.colors, 3);
  m.computeBoundingSphere();
  return m;
}

export interface ChunkObject {
  group: THREE.Group;
  /** Vegetation objects that are hidden beyond a short distance (cheap LOD). */
  vegetation: THREE.Object3D[];
  dispose(): void;
}

export function buildChunkObject(data: ChunkData, assets: SharedAssets): ChunkObject {
  const group = new THREE.Group();
  group.name = `chunk ${data.cx},${data.cz}`;
  const ownGeometries: THREE.BufferGeometry[] = [];

  // Terrain
  const N = R + 1;
  const tg = new THREE.BufferGeometry();
  const pos = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 3;
      pos[k] = i * CELL;
      pos[k + 1] = data.heights[j * N + i];
      pos[k + 2] = j * CELL;
    }
  }
  const idx = new Uint32Array(R * R * 6);
  let p = 0;
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < R; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      idx[p++] = a;
      idx[p++] = c;
      idx[p++] = b;
      idx[p++] = b;
      idx[p++] = c;
      idx[p++] = d;
    }
  }
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  tg.setIndex(new THREE.BufferAttribute(idx, 1));
  tg.computeVertexNormals();
  tg.computeBoundingSphere();
  ownGeometries.push(tg);
  const terrain = new THREE.Mesh(tg, assets.materials.terrain);
  terrain.name = 'terrain';
  group.add(terrain);

  // Roads and paint
  for (const cls of ['rural', 'town', 'city', 'highway'] as RoadClass[]) {
    const m = surfaceMesh(data.roads[cls], assets.materials.road[cls]);
    if (m) {
      group.add(m);
      ownGeometries.push(m.geometry);
    }
  }
  const marks = surfaceMesh(data.markings, assets.materials.marking);
  if (marks) {
    group.add(marks);
    ownGeometries.push(marks.geometry);
  }

  // Vegetation and buildings
  const vegetation: THREE.Object3D[] = [];
  const addInst = (geo: THREE.BufferGeometry, mat: THREE.Material, inst: InstanceData, veg: boolean) => {
    const m = instanced(geo, mat, inst);
    if (!m) return;
    group.add(m);
    if (veg) vegetation.push(m);
  };
  addInst(assets.geometry.conifer, assets.materials.tree, data.conifers, true);
  addInst(assets.geometry.broadleaf, assets.materials.tree, data.broadleaves, true);
  addInst(assets.geometry.box, assets.materials.body, data.bodies, false);
  addInst(assets.geometry.prism, assets.materials.roof, data.roofs, false);

  return {
    group,
    vegetation,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      for (const g of ownGeometries) g.dispose();
    },
  };
}
