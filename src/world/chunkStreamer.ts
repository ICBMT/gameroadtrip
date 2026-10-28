/**
 * Streams chunks around the player.
 *
 * - Desired set: all chunks within a circular radius of the player.
 * - Missing chunks are generated in Web Workers, nearest and forward-most first.
 * - Chunks right next to the player are generated synchronously if they are
 *   not ready, so the player can never drive onto a hole.
 * - Chunks that fall well outside the radius are unloaded and their GPU buffers freed.
 * - Floating origin: every chunk group is positioned relative to the player's
 *   logical position, so render coordinates stay small however far the player drives.
 */
import * as THREE from 'three';
import { WORLD } from './config';
import type { ChunkData } from './chunkTypes';
import { generateChunk } from './chunkGenerator';
import { buildChunkObject, type ChunkObject, type SharedAssets } from '../rendering/chunkMeshes';
import type { ChunkRequest, ChunkResponse } from '../workers/chunk.worker';

const S = WORLD.CHUNK_SIZE;

interface Loaded {
  cx: number;
  cz: number;
  obj: ChunkObject;
}

interface Pending {
  cx: number;
  cz: number;
  key: string;
  requested: boolean;
}

export class ChunkStreamer {
  readonly root = new THREE.Group();
  private loaded = new Map<string, Loaded>();
  private pending = new Map<string, Pending>();
  private queue: Pending[] = [];
  private workers: Worker[] = [];
  private inflight = new Map<number, string>();
  private nextId = 1;
  private readyBuffer: { key: string; data: ChunkData }[] = [];
  private radius = 3;
  private vegDistance = 2;

  constructor(
    scene: THREE.Scene,
    private seed: number,
    private assets: SharedAssets,
    workerCount: number,
  ) {
    scene.add(this.root);
    for (let i = 0; i < workerCount; i++) {
      try {
        const w = new Worker(new URL('../workers/chunk.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<ChunkResponse>) => this.onWorkerMessage(e.data);
        w.onerror = (e) => console.error('chunk worker error', e.message);
        this.workers.push(w);
      } catch (err) {
        console.warn('Web Workers unavailable, generating on main thread', err);
      }
    }
  }

  setRadius(chunks: number) {
    this.radius = chunks;
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private key(cx: number, cz: number) {
    return `${cx},${cz}`;
  }

  private onWorkerMessage(msg: ChunkResponse) {
    const key = this.inflight.get(msg.id);
    if (key === undefined) return;
    this.inflight.delete(msg.id);
    this.readyBuffer.push({ key, data: msg.data });
  }

  /**
   * Call once per frame with the player's logical world position and forward direction.
   * @param px player world x
   * @param pz player world z
   * @param fx forward unit vector x
   * @param fz forward unit vector z
   */
  update(px: number, pz: number, fx: number, fz: number, budget = 3) {
    const pcx = Math.floor(px / S);
    const pcz = Math.floor(pz / S);
    const R = this.radius;
    const desired = new Set<string>();

    for (let dz = -R - 1; dz <= R + 1; dz++) {
      for (let dx = -R - 1; dx <= R + 1; dx++) {
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const k = this.key(cx, cz);
        desired.add(k);
        if (this.loaded.has(k) || this.pending.has(k)) continue;
        const p: Pending = { cx, cz, key: k, requested: false };
        this.pending.set(k, p);
        this.queue.push(p);
      }
    }

    // Prioritise: nearest first, with a bias towards chunks ahead of the car.
    this.queue.sort((a, b) => {
      const pa = this.priority(a, pcx, pcz, fx, fz);
      const pb = this.priority(b, pcx, pcz, fx, fz);
      return pa - pb;
    });

    // Synchronous fallback for the chunks the player is standing in or touching.
    let sync = 0;
    for (const p of [...this.queue]) {
      if (sync >= 2) break;
      if (Math.abs(p.cx - pcx) <= 1 && Math.abs(p.cz - pcz) <= 1) {
        this.queue.splice(this.queue.indexOf(p), 1);
        this.pending.delete(p.key);
        this.install(p.key, p.cx, p.cz, generateChunk(this.seed, p.cx, p.cz));
        sync++;
      }
    }

    // Dispatch to workers while they have room.
    const capacity = Math.max(1, this.workers.length) * 2;
    while (this.queue.length > 0 && this.inflight.size < capacity) {
      const p = this.queue.shift()!;
      if (!desired.has(p.key)) {
        this.pending.delete(p.key);
        continue;
      }
      if (this.workers.length === 0) {
        this.pending.delete(p.key);
        this.install(p.key, p.cx, p.cz, generateChunk(this.seed, p.cx, p.cz));
        continue;
      }
      const id = this.nextId++;
      this.inflight.set(id, p.key);
      p.requested = true;
      const worker = this.workers[id % this.workers.length];
      const req: ChunkRequest = { id, seed: this.seed, cx: p.cx, cz: p.cz };
      worker.postMessage(req);
    }

    // Install finished chunks, budgeted per frame.
    let installed = 0;
    while (this.readyBuffer.length > 0 && installed < budget) {
      const r = this.readyBuffer.shift()!;
      this.pending.delete(r.key);
      if (!desired.has(r.key)) continue; // no longer needed
      this.install(r.key, r.data.cx, r.data.cz, r.data);
      installed++;
    }

    // Unload chunks that have fallen out of range.
    for (const [k, l] of this.loaded) {
      if (!desired.has(k)) {
        this.root.remove(l.obj.group);
        l.obj.dispose();
        this.loaded.delete(k);
      }
    }
    // Drop requests that are no longer wanted from the queue (in-flight ones are discarded on arrival).
    this.queue = this.queue.filter((p) => desired.has(p.key) || p.requested);
    for (const [k, p] of this.pending) {
      if (!desired.has(k) && !p.requested) this.pending.delete(k);
    }

    // Floating origin + vegetation LOD.
    for (const l of this.loaded.values()) {
      l.obj.group.position.set(l.cx * S - px, 0, l.cz * S - pz);
      const dist = Math.hypot((l.cx + 0.5) * S - px, (l.cz + 0.5) * S - pz);
      const vis = dist < this.vegDistance * S + S;
      for (const v of l.obj.vegetation) v.visible = vis;
    }
  }

  setVegetationDistance(chunks: number) {
    this.vegDistance = chunks;
  }

  private priority(p: Pending, pcx: number, pcz: number, fx: number, fz: number): number {
    const dx = p.cx - pcx;
    const dz = p.cz - pcz;
    const d = Math.hypot(dx, dz);
    const ahead = d > 0 ? (dx * fx + dz * fz) / d : 0;
    return d - ahead * 0.8;
  }

  private install(key: string, cx: number, cz: number, data: ChunkData) {
    if (this.loaded.has(key)) return;
    const obj = buildChunkObject(data, this.assets);
    this.root.add(obj.group);
    this.loaded.set(key, { cx, cz, obj });
  }

  dispose() {
    for (const l of this.loaded.values()) {
      this.root.remove(l.obj.group);
      l.obj.dispose();
    }
    this.loaded.clear();
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
