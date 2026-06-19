import * as THREE from 'three';

// Multiple camera perspectives with smooth follow. Chase is the default.
const MODES = ['chase', 'far', 'cockpit', 'cinematic'];
const LABELS = { chase: 'CHASE', far: 'WIDE', cockpit: 'COCKPIT', cinematic: 'CINEMATIC' };

export class CameraRig {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target; // Plane
    this.modeIndex = 0;
    this.mode = MODES[0];

    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._cinT = 0;
    this._shake = 0;

    camera.position.set(0, 175, -30);
  }

  next() {
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
    this.mode = MODES[this.modeIndex];
    return LABELS[this.mode];
  }

  setMode(name) {
    // 'menu' is an attract-screen-only view and isn't part of the cycle list.
    const i = MODES.indexOf(name);
    this.mode = name;
    if (i >= 0) this.modeIndex = i;
  }

  get label() { return LABELS[this.mode]; }

  addShake(amount) { this._shake = Math.min(1.2, this._shake + amount); }

  update(dt, time) {
    const t = this.target;
    const q = t.group.quaternion;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const p = t.group.position;

    const speedFactor = (t.speed - t.minSpeed) / (t.maxSpeed - t.minSpeed);

    if (this.mode === 'chase') {
      this._desired.copy(p)
        .addScaledVector(fwd, -16 - speedFactor * 6)
        .addScaledVector(up, 5);
      const lerp = 1 - Math.pow(0.0001, dt);
      this.camera.position.lerp(this._desired, Math.min(1, lerp * 1.0));
      this._look.copy(p).addScaledVector(fwd, 26);
      this._applyLook(up, dt);
    } else if (this.mode === 'far') {
      this._desired.copy(p)
        .addScaledVector(fwd, -34)
        .addScaledVector(up, 10)
        .addScaledVector(right, 8);
      this.camera.position.lerp(this._desired, Math.min(1, (1 - Math.pow(0.0005, dt))));
      this._look.copy(p).addScaledVector(fwd, 18);
      this._applyLook(this._up, dt);
    } else if (this.mode === 'cockpit') {
      this._desired.copy(p).addScaledVector(fwd, 1.4).addScaledVector(up, 1.0);
      this.camera.position.copy(this._desired);
      this._look.copy(p).addScaledVector(fwd, 60);
      this.camera.up.copy(up);
      this.camera.lookAt(this._look);
    } else if (this.mode === 'cinematic') {
      this._cinT += dt * 0.5;
      const orbit = new THREE.Vector3(
        Math.cos(this._cinT) * 22,
        6 + Math.sin(this._cinT * 0.7) * 4,
        Math.sin(this._cinT) * 22
      );
      this._desired.copy(p).add(orbit);
      this.camera.position.lerp(this._desired, Math.min(1, (1 - Math.pow(0.02, dt))));
      this._look.copy(p);
      this._applyLook(this._up, dt);
    } else if (this.mode === 'menu') {
      // Attract screen: a steady three-quarter view that follows the jet
      // smoothly — no orbit, no jolt — so the game reads clearly on the menu.
      this._desired.copy(p)
        .addScaledVector(fwd, -21)
        .addScaledVector(up, 6)
        .addScaledVector(right, 12);
      this.camera.position.lerp(this._desired, Math.min(1, (1 - Math.pow(0.0008, dt))));
      this._look.copy(p).addScaledVector(fwd, 14);
      this._applyLook(this._up, dt);
    }

    // Camera shake on hits / explosions nearby.
    if (this._shake > 0.001) {
      const s = this._shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 2;
      this.camera.position.y += (Math.random() - 0.5) * s * 2;
      this.camera.position.z += (Math.random() - 0.5) * s * 2;
      this._shake *= Math.pow(0.0005, dt);
    }

    // Dynamic FOV with speed for sense of velocity.
    const targetFov = 62 + speedFactor * 16 + (this.mode === 'cockpit' ? 8 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
  }

  _applyLook(up, dt) {
    // Smoothly interpolate the up vector for banking feel without snapping.
    this.camera.up.lerp(up, Math.min(1, dt * 3)).normalize();
    this.camera.lookAt(this._look);
  }
}
