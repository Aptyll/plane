import * as THREE from 'three';
import { buildJet, LIVERY } from '../entities/jetModel.js';

// Rocket-League-style instant replay. While playing we record a short rolling
// buffer of every aircraft's transform; on the player's death we play the last
// few seconds back in slow motion with a cinematic orbit framing the player and
// whatever killed them, so fast deaths are easy to read.
const _center = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class Replay {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.frames = [];
    this.window = 2.8;  // seconds of footage before the death
    this.slow = 0.45;   // playback speed (slow motion)
    this.tail = 1.2;    // seconds of aftermath after the death moment
    this.active = false;
    this.focus = new THREE.Vector3();
    this.ghosts = new Map();
    this._camPos = new THREE.Vector3();
  }

  // Called every gameplay frame.
  record(t, player, enemies) {
    const actors = [];
    if (player.alive) actors.push(this._snap('P', 'blue', player.group));
    for (const e of enemies) if (e.alive) actors.push(this._snap('E' + e.group.id, 'red', e.group));
    this.frames.push({ t, actors });
    const minT = t - (this.window + 0.6);
    while (this.frames.length && this.frames[0].t < minT) this.frames.shift();
  }

  _snap(id, team, g) {
    return {
      id, team,
      px: g.position.x, py: g.position.y, pz: g.position.z,
      qx: g.quaternion.x, qy: g.quaternion.y, qz: g.quaternion.z, qw: g.quaternion.w,
    };
  }

  begin(deathTime, deathPos, killerId) {
    this.deathTime = deathTime;
    this.deathPos = deathPos.clone();
    this.killerId = killerId;
    this.playTime = deathTime - this.window;
    this.explosionFired = false;
    this.azimuth = Math.random() * Math.PI * 2;
    this.focus.copy(deathPos);
    this._camInit = false;

    // Window the buffer and build per-frame lookup maps + ghost meshes.
    this._frames = this.frames.filter((f) => f.t >= this.playTime - 0.05);
    this.ghosts.clear();
    for (const f of this._frames) {
      f._map = new Map();
      for (const a of f.actors) {
        f._map.set(a.id, a);
        if (!this.ghosts.has(a.id)) {
          const mesh = buildJet(a.team === 'blue' ? LIVERY.blue : LIVERY.red);
          mesh.visible = false;
          this.scene.add(mesh);
          this.ghosts.set(a.id, mesh);
        }
      }
    }
    this.active = this._frames.length > 0;
    return this.active;
  }

  update(dt, camera) {
    if (!this.active) return true;
    this.playTime += dt * this.slow;

    const frames = this._frames;
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].t <= this.playTime) i++;
    const fa = frames[i];
    const fb = frames[Math.min(i + 1, frames.length - 1)];
    const span = (fb.t - fa.t) || 1;
    const alpha = THREE.MathUtils.clamp((this.playTime - fa.t) / span, 0, 1);

    let playerPos = null, killerPos = null;
    for (const [id, mesh] of this.ghosts) {
      const a = fa._map.get(id);
      const b = fb._map.get(id);
      if (!a && !b) { mesh.visible = false; continue; }
      const s = a || b, e = b || a;
      mesh.position.set(
        THREE.MathUtils.lerp(s.px, e.px, alpha),
        THREE.MathUtils.lerp(s.py, e.py, alpha),
        THREE.MathUtils.lerp(s.pz, e.pz, alpha));
      _qa.set(s.qx, s.qy, s.qz, s.qw);
      _qb.set(e.qx, e.qy, e.qz, e.qw);
      _qa.slerp(_qb, alpha);
      mesh.quaternion.copy(_qa);
      mesh.visible = true;
      if (id === 'P') playerPos = mesh.position;
      if (id === this.killerId) killerPos = mesh.position;
    }

    // Framing: keep player + killer both in shot, else center on the player.
    let sep = 38;
    if (playerPos && killerPos) {
      _center.copy(playerPos).add(killerPos).multiplyScalar(0.5);
      sep = playerPos.distanceTo(killerPos);
    } else if (playerPos) {
      _center.copy(playerPos);
    } else {
      _center.copy(this.deathPos);
    }
    this.focus.lerp(_center, Math.min(1, dt * 2.5));

    const dist = THREE.MathUtils.clamp(sep * 1.15 + 32, 44, 130);
    this.azimuth += dt * 0.4;
    this._camPos.set(
      this.focus.x + Math.cos(this.azimuth) * dist,
      this.focus.y + dist * 0.4 + 12,
      this.focus.z + Math.sin(this.azimuth) * dist);
    if (!this._camInit) { camera.position.copy(this._camPos); this._camInit = true; }
    else camera.position.lerp(this._camPos, Math.min(1, dt * 2.5));
    camera.up.set(0, 1, 0);
    camera.lookAt(this.focus);
    camera.fov += (52 - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();

    // Re-stage the killing explosion at the right moment.
    if (!this.explosionFired && this.playTime >= this.deathTime) {
      this.fx.explosion(this.deathPos, { size: 13, color: 0xffae42 });
      this.explosionFired = true;
    }

    if (this.playTime >= this.deathTime + this.tail) { this.cleanup(); return true; }
    return false;
  }

  cleanup() {
    for (const [, mesh] of this.ghosts) {
      this.scene.remove(mesh);
      mesh.traverse((o) => {
        if (o.isMesh) { o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }
      });
    }
    this.ghosts.clear();
    this._frames = null;
    this.active = false;
  }

  resetBuffer() {
    if (this.active) this.cleanup();
    this.frames.length = 0;
  }
}
