import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateChunk } from '../src/world/chunkGenerator';
import { createSharedAssets, buildChunkObject } from '../src/rendering/chunkMeshes';

// Geometry construction does not need WebGL, so chunk meshes can be verified in Node.
test('chunk meshes build with consistent counts and valid normals', () => {
  const assets = createSharedAssets();
  let objects = 0;
  let instances = 0;
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const data = generateChunk(12345, cx, cz);
      const obj = buildChunkObject(data, assets);
      objects++;
      obj.group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) {
          instances += o.count;
          assert.ok(o.instanceMatrix.count === o.count);
          assert.ok(o.instanceColor, 'instance colours set');
        }
        if (o instanceof THREE.Mesh) {
          const pos = o.geometry.getAttribute('position');
          for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i] as number));
        }
      });
      obj.dispose();
    }
  }
  assert.equal(objects, 25);
  assert.ok(instances > 0);
});

test('terrain grid matches chunk resolution', () => {
  const assets = createSharedAssets();
  const data = generateChunk(12345, 0, 0);
  const obj = buildChunkObject(data, assets);
  const terrain = obj.group.getObjectByName('terrain') as THREE.Mesh;
  assert.equal(terrain.geometry.getAttribute('position').count, 41 * 41);
  assert.equal(terrain.geometry.getIndex()!.count, 40 * 40 * 6);
  obj.dispose();
});
