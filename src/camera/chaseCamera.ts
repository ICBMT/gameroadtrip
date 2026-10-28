/**
 * Smooth chase camera with four modes. Works in render coordinates, where the
 * player is always at the origin (floating origin), so everything stays precise.
 */
import * as THREE from 'three';
import { wrapAngle } from '../utils/math';

export type CameraMode = 'chase' | 'close' | 'hood' | 'first';
export const CAMERA_MODES: CameraMode[] = ['chase', 'close', 'hood', 'first'];

export interface CameraTarget {
  /** Car position in render coordinates (player at origin). */
  pos: THREE.Vector3;
  heading: number;
  speed: number; // m/s
  steer: number;
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();
  private yaw = 0;
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.3, 4000);
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  cycleMode(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.initialised = false;
    return this.mode;
  }

  /** groundAt returns the surface height at a render-space x,z. */
  update(t: CameraTarget, dt: number, groundAt: (x: number, z: number) => number) {
    // Camera yaw lags the car heading, so steering feels weighty.
    this.yaw += wrapAngle(t.heading - this.yaw) * Math.min(1, dt * 3.5);
    const yx = Math.sin(this.yaw);
    const yz = Math.cos(this.yaw);

    const speedK = Math.min(1, t.speed / 40);
    let back: number;
    let up: number;
    let lookAhead: number;
    let fov: number;
    switch (this.mode) {
      case 'close':
        back = 5.2 + speedK * 1.5;
        up = 2.2;
        lookAhead = 8;
        fov = 62 + speedK * 12;
        break;
      case 'hood':
        back = -1.0;
        up = 1.25;
        lookAhead = 30;
        fov = 72 + speedK * 8;
        break;
      case 'first':
        back = -0.2;
        up = 1.3;
        lookAhead = 30;
        fov = 75;
        break;
      default:
        back = 9 + speedK * 4;
        up = 3.6 + speedK * 0.4;
        lookAhead = 12;
        fov = 62 + speedK * 14;
    }
    const target = new THREE.Vector3(t.pos.x - yx * back, t.pos.y + up, t.pos.z - yz * back);
    // Keep the camera above the ground it is looking at.
    const gy = groundAt(target.x, target.z) + 1.4;
    if (target.y < gy) target.y = gy;

    const look = new THREE.Vector3(t.pos.x + yx * lookAhead, t.pos.y + (this.mode === 'chase' ? 1.0 : 0.9), t.pos.z + yz * lookAhead);

    if (!this.initialised) {
      this.smoothPos.copy(target);
      this.smoothLook.copy(look);
      this.initialised = true;
    } else {
      const kp = 1 - Math.exp(-dt * (this.mode === 'first' || this.mode === 'hood' ? 30 : 6));
      const kl = 1 - Math.exp(-dt * 10);
      this.smoothPos.lerp(target, kp);
      this.smoothLook.lerp(look, kl);
    }
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.smoothLook);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Whether the car body should be drawn (hidden in first-person). */
  showCar(): boolean {
    return this.mode !== 'first';
  }
}
