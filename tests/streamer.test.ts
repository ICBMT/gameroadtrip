import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChunkStreamer } from '../src/world/chunkStreamer';
import { createSharedAssets } from '../src/rendering/chunkMeshes';
import { findSpawn } from '../src/roads/roadGraph';
import { WORLD } from '../src/world/config';

const SEED = 12345;
const S = WORLD.CHUNK_SIZE;

test('streamer keeps the player surrounded by loaded chunks while driving, and unloads behind', () => {
  const scene = new THREE.Scene();
  const streamer = new ChunkStreamer(scene, SEED, createSharedAssets(), 0); // main-thread generation
  streamer.setRadius(2);
  const sp = findSpawn(SEED);
  let x = sp.x;
  let z = sp.z;
  const dirX = Math.sin(sp.heading);
  const dirZ = Math.cos(sp.heading);
  let maxLoaded = 0;
  let holes = 0;
  for (let step = 0; step < 300; step++) {
    x += dirX * 8; // 8 m per update, about 2.4 km total
    z += dirZ * 8;
    streamer.update(x, z, dirX, dirZ, 6);
    maxLoaded = Math.max(maxLoaded, streamer.loadedCount);
    // Every chunk touching the player must be present: no chunk-loading wall.
    const pcx = Math.floor(x / S);
    const pcz = Math.floor(z / S);
    const names = new Set((streamer.root.children as THREE.Group[]).map((g) => g.name));
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!names.has(`chunk ${pcx + dx},${pcz + dz}`)) holes++;
      }
    }
    // Floating origin: chunk groups are positioned relative to the player.
    const g = streamer.root.children[0] as THREE.Group;
    if (g) assert.ok(Math.abs(g.position.x) < 2000 && Math.abs(g.position.z) < 2000);
  }
  assert.equal(holes, 0, 'no missing chunks around the player');
  assert.ok(maxLoaded < 60, `loaded chunk count bounded (${maxLoaded})`);
  // Chunks far behind have been unloaded.
  const names = (streamer.root.children as THREE.Group[]).map((g) => g.name);
  const startCx = Math.floor(sp.x / S);
  assert.ok(!names.includes(`chunk ${startCx},${Math.floor(sp.z / S)}`) || Math.hypot(x - sp.x, z - sp.z) < 4 * S, 'start chunk unloaded once far away');
  streamer.dispose();
});
