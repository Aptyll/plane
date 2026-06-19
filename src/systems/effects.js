import * as THREE from 'three';

// ---------- Contrail / smoke trail ----------
// A rolling ribbon built from recent world positions. Fades along its length.
export class Trail {
  constructor(scene, { length = 40, color = 0xffffff, width = 0.5, opacity = 0.6 } = {}) {
    this.scene = scene;
    this.length = length;
    this.points = [];
    this.width = width;

    const positions = new Float32Array(length * 2 * 3);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colors = new Float32Array(length * 2 * 3);
    this.geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.mat = new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.baseColor = new THREE.Color(color);

    // Build index for a triangle strip ribbon.
    const idx = [];
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    this.geom.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  push(pos, up) {
    this.points.unshift({ p: pos.clone(), up: up.clone() });
    if (this.points.length > this.length) this.points.pop();
    this._rebuild();
  }

  _rebuild() {
    const posAttr = this.geom.attributes.position;
    const colAttr = this.geom.attributes.color;
    const n = this.points.length;
    for (let i = 0; i < this.length; i++) {
      const pt = this.points[Math.min(i, n - 1)] || this.points[n - 1];
      if (!pt) continue;
      const t = i / this.length;
      const w = this.width * (1 - t);
      const off = pt.up.clone().multiplyScalar(w);
      const l = pt.p.clone().add(off);
      const r = pt.p.clone().sub(off);
      posAttr.setXYZ(i * 2, l.x, l.y, l.z);
      posAttr.setXYZ(i * 2 + 1, r.x, r.y, r.z);
      const fade = (1 - t) * (i < n ? 1 : 0);
      colAttr.setXYZ(i * 2, this.baseColor.r * fade, this.baseColor.g * fade, this.baseColor.b * fade);
      colAttr.setXYZ(i * 2 + 1, this.baseColor.r * fade, this.baseColor.g * fade, this.baseColor.b * fade);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geom.dispose();
    this.mat.dispose();
  }
}

// ---------- Afterburner ----------
export function makeAfterburner(withLight = true) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.4, 12, 1, true), mat);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -1.3;
  grp.add(cone);

  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 10, 1, true), coreMat);
  core.rotation.x = -Math.PI / 2;
  core.position.z = -0.9;
  grp.add(core);

  let light = null;
  if (withLight) {
    light = new THREE.PointLight(0x66c8ff, 0, 18, 2);
    light.position.z = -1.5;
    grp.add(light);
  }

  grp.userData = { cone, core, light, mat, coreMat };
  return grp;
}

export function updateAfterburner(grp, throttle, dt) {
  const { cone, core, light, mat, coreMat } = grp.userData;
  const flick = 0.85 + Math.random() * 0.3;
  const len = THREE.MathUtils.lerp(0.4, 1.5, throttle) * flick;
  cone.scale.set(1, len, 1);
  core.scale.set(1, len * 0.9, 1);
  mat.opacity = 0.25 + throttle * 0.7;
  coreMat.opacity = 0.3 + throttle * 0.6;
  if (light) light.intensity = throttle * 4 * flick;
}

// ---------- Explosions + particle pool ----------
export class FXManager {
  constructor(scene) {
    this.scene = scene;
    this.explosions = [];
    this._sphereGeo = new THREE.SphereGeometry(1, 16, 12);
  }

  explosion(pos, { size = 6, color = 0xffae42, light: useLight = size >= 5 } = {}) {
    // Flash sphere
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const flash = new THREE.Mesh(this._sphereGeo, flashMat);
    flash.position.copy(pos);
    flash.scale.setScalar(size * 0.4);
    this.scene.add(flash);

    // Fireball
    const fireMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const fire = new THREE.Mesh(this._sphereGeo, fireMat);
    fire.position.copy(pos);
    fire.scale.setScalar(size * 0.2);
    this.scene.add(fire);

    // Light burst (only for sizeable blasts to keep dynamic-light count low)
    let light = null;
    if (useLight) {
      light = new THREE.PointLight(color, 8, size * 12, 2);
      light.position.copy(pos);
      this.scene.add(light);
    }

    // Debris particles
    const debrisCount = 26;
    const dGeo = new THREE.BufferGeometry();
    const dPos = new Float32Array(debrisCount * 3);
    const vel = [];
    for (let i = 0; i < debrisCount; i++) {
      dPos[i * 3] = pos.x; dPos[i * 3 + 1] = pos.y; dPos[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      vel.push(dir.multiplyScalar(8 + Math.random() * 22));
    }
    dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    const dMat = new THREE.PointsMaterial({ color: 0xffd27f, size: 1.6, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const debris = new THREE.Points(dGeo, dMat);
    this.scene.add(debris);

    // Smoke puff
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5, depthWrite: false });
    const smoke = new THREE.Mesh(this._sphereGeo, smokeMat);
    smoke.position.copy(pos);
    smoke.scale.setScalar(size * 0.3);
    this.scene.add(smoke);

    this.explosions.push({ flash, flashMat, fire, fireMat, light, debris, dGeo, dMat, vel, smoke, smokeMat, t: 0, size });
  }

  update(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.t += dt;
      const k = e.t;
      // flash
      e.flash.scale.setScalar(e.size * (0.4 + k * 4));
      e.flashMat.opacity = Math.max(0, 1 - k * 6);
      // fireball expand + fade
      e.fire.scale.setScalar(e.size * (0.2 + k * 2.2));
      e.fireMat.opacity = Math.max(0, 0.95 - k * 1.6);
      // light
      if (e.light) e.light.intensity = Math.max(0, 8 - k * 20);
      // debris
      const dp = e.dGeo.attributes.position;
      for (let j = 0; j < e.vel.length; j++) {
        e.vel[j].y -= 30 * dt;
        dp.setXYZ(j,
          dp.getX(j) + e.vel[j].x * dt,
          dp.getY(j) + e.vel[j].y * dt,
          dp.getZ(j) + e.vel[j].z * dt);
      }
      dp.needsUpdate = true;
      e.dMat.opacity = Math.max(0, 1 - k * 1.1);
      // smoke
      e.smoke.scale.setScalar(e.size * (0.3 + k * 1.8));
      e.smoke.position.y += 6 * dt;
      e.smokeMat.opacity = Math.max(0, 0.5 - k * 0.5);

      if (k > 1.4) {
        this.scene.remove(e.flash, e.fire, e.debris, e.smoke);
        if (e.light) this.scene.remove(e.light);
        e.flashMat.dispose(); e.fireMat.dispose(); e.dGeo.dispose(); e.dMat.dispose(); e.smokeMat.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }
}
