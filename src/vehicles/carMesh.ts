/** Low-poly car built from primitives. Nose points along +Z. */
import * as THREE from 'three';

export interface CarVisual {
  group: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  headlights: THREE.SpotLight;
  setPaint(hex: number): void;
}

export function createCarVisual(): CarVisual {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paintMat = new THREE.MeshLambertMaterial({ color: 0xd9542b });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2430 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  const tail = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.2), paintMat);
  lower.position.set(0, 0.6, 0);
  body.add(lower);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), paintMat);
  cabin.position.set(0, 1.2, -0.25);
  body.add(cabin);
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.05), glass);
  windscreen.position.set(0, 1.25, 0.84);
  windscreen.rotation.x = -0.5;
  body.add(windscreen);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.05), glass);
  rear.position.set(0, 1.25, -1.36);
  rear.rotation.x = 0.5;
  body.add(rear);

  const wheels: THREE.Object3D[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [
    [-0.95, 1.35],
    [0.95, 1.35],
    [-0.95, -1.35],
    [0.95, -1.35],
  ]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.36, z);
    group.add(w);
    wheels.push(w);
  }

  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), lamp);
    h.position.set(x, 0.7, 2.11);
    body.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.05), tail);
    t.position.set(x, 0.7, -2.11);
    body.add(t);
  }

  const headlights = new THREE.SpotLight(0xfff0d0, 0, 90, Math.PI / 6, 0.4, 1.2);
  headlights.position.set(0, 0.8, 2.2);
  headlights.target.position.set(0, 0, 25);
  body.add(headlights);
  body.add(headlights.target);

  return {
    group,
    body,
    wheels,
    headlights,
    setPaint(hex: number) {
      paintMat.color.setHex(hex);
    },
  };
}
