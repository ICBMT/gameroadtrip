/**
 * Ground queries for physics and the camera. Uses the same surface function as
 * the chunk meshes, so the car sits exactly on the rendered road and terrain.
 * Caches nearby road segments so each query is cheap.
 */
import { roadsInRect, nearestRoad, type RoadSegment } from '../roads/roadGraph';
import { surfaceHeight } from './chunkGenerator';

export class GroundQuery {
  private segs: RoadSegment[] = [];
  private cx = Number.POSITIVE_INFINITY;
  private cz = Number.POSITIVE_INFINITY;
  private static readonly REFRESH = 40;
  private static readonly SPAN = 90;

  constructor(private seed: number) {}

  private ensure(x: number, z: number) {
    if (Math.abs(x - this.cx) > GroundQuery.REFRESH || Math.abs(z - this.cz) > GroundQuery.REFRESH) {
      const r = GroundQuery.SPAN;
      this.segs = roadsInRect(this.seed, x - r, z - r, x + r, z + r);
      this.cx = x;
      this.cz = z;
    }
  }

  /** Surface height (metres) at world (x, z). */
  height(x: number, z: number): number {
    this.ensure(x, z);
    return surfaceHeight(this.seed, x, z, this.segs);
  }

  /** Nearest road hit within maxDist (or null). */
  road(x: number, z: number, maxDist = 150) {
    this.ensure(x, z);
    return nearestRoad(this.segs, x, z, maxDist);
  }

  /** Whether (x, z) is on the paved/dirt surface of a road. */
  onRoad(x: number, z: number): boolean {
    const hit = this.road(x, z, 12);
    return !!hit && hit.dist <= hit.halfWidth;
  }
}
