import type { RoadClass } from '../roads/roadGraph';

/** Plain triangle mesh data in chunk-local coordinates (metres). */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array;
}

/** Instanced object data: 16 floats per instance (column-major matrix) plus RGB colours. */
export interface InstanceData {
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface ChunkData {
  cx: number;
  cz: number;
  /** Terrain heights, (RES+1)^2 grid, row-major (z outer, x inner). */
  heights: Float32Array;
  /** Terrain vertex colours, RGB per vertex. */
  colors: Float32Array;
  roads: Record<RoadClass, MeshData>;
  /** Lane markings (white paint). */
  markings: MeshData;
  conifers: InstanceData;
  broadleaves: InstanceData;
  bodies: InstanceData;
  roofs: InstanceData;
  /** Ids of cities whose centre lies within the chunk or near it (for stats). */
  cityIds: number[];
  /** Dominant biome sample counts for stats/HUD (indexed by biome name). */
  biomeHint: string;
}
