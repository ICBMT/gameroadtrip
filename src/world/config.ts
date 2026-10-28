/** Global world constants. Changing these changes the generated world. */
export const WORLD = {
  /** Metres per chunk side. */
  CHUNK_SIZE: 200,
  /** Terrain grid cells per chunk side (cell = 5 m). */
  CHUNK_RES: 40,
  /** Sea level in metres. Terrain below this is water. */
  SEA_LEVEL: 0,
  /** Road lattice spacing in metres (nodes sit on a jittered lattice). */
  ROAD_CELL: 400,
  /** Road polyline sampling step in metres. */
  ROAD_STEP: 5,
} as const;

export const DEFAULT_SEED = 20261028;
