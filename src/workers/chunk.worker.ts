/// <reference lib="webworker" />
/**
 * Web Worker entry: generates chunk data off the main thread so driving stays smooth.
 * Generation is a pure function, so the result is identical to main-thread generation.
 */
import { generateChunk } from '../world/chunkGenerator';
import type { ChunkData, InstanceData, MeshData } from '../world/chunkTypes';

export interface ChunkRequest {
  id: number;
  seed: number;
  cx: number;
  cz: number;
}
export interface ChunkResponse {
  id: number;
  data: ChunkData;
}

function transferables(d: ChunkData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [d.heights.buffer as ArrayBuffer, d.colors.buffer as ArrayBuffer];
  const mesh = (m: MeshData) => {
    out.push(m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer);
  };
  const inst = (i: InstanceData) => {
    out.push(i.matrices.buffer as ArrayBuffer, i.colors.buffer as ArrayBuffer);
  };
  Object.values(d.roads).forEach(mesh);
  mesh(d.markings);
  inst(d.conifers);
  inst(d.broadleaves);
  inst(d.bodies);
  inst(d.roofs);
  return out;
}

self.onmessage = (e: MessageEvent<ChunkRequest>) => {
  const { id, seed, cx, cz } = e.data;
  const data = generateChunk(seed, cx, cz);
  const response: ChunkResponse = { id, data };
  (self as unknown as Worker).postMessage(response, transferables(data));
};
