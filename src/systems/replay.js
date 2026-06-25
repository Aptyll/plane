import * as THREE from 'three';
import { buildJet, LIVERY } from '../entities/jetModel.js';

// Rocket-League-style instant replay.
//
// While playing we record a short rolling buffer of every aircraft's transform.
// On death we replay the last ~2s in slow motion from ONE deliberately composed
// camera angle (not a spin): a 3/4 "kill-cam" placed behind-and-above the
// victim, on the side the attack came from, so you clearly see your jet, the
// attacker, and the impact. The vantage is computed once from the real kill
// geometry (who/what actually hit you) and then tracks the victim so the framing
// stays stable and readable.
const UP = new THREE.Vector3(0, 1, 0);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _side = new THREE.Vector3();
const _line = new THREE.Vector3();
const _sample = new THREE.Vector3();

export class Replay {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.frames = [];
    this.window = 1.8;  // seconds of footage before the death
    this.slow = 0.5;    // playback speed (slow motion)
    this.tail = 1.2;    // seconds of aftermath after the impact
    this.active = false;
    this.focus = new THREE.Vector3();
    this.ghosts = new Map();

    this._camOffset = new THREE.Vector3();
    this._desiredCam = new THREE.Vector3();
  }

  record(t, player, wingman, enemies) {
    const actors = [];
    if (player?.group) actors.push(this._snap('player', 'blue', player.group));
    if (wingman?.alive && wingman.group) actors.push(this._snap(wingman.id, 'blue', wingman.group));
    for (const e of enemies) if (e.alive) actors.push(this._snap(e.id, 'red', e.group));
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

  begin(deathTime, deathPos, threat) {
    this.deathTime = deathTime;
    this.deathPos = deathPos.clone();
    this.playTime = deathTime - this.window;
    this.explosionFired = false;
    this._started = false;

    // Window the buffer; build per-frame lookup maps + ghost meshes.
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
    if (!this.active) return false;

    // The attacker we want in frame, taken from the REAL kill (if recorded).
    this.killerId = (threat && threat.sourceId && this.ghosts.has(threat.sourceId)) ? threat.sourceId : null;

    this._composeShot(threat);
    this.focus.copy(deathPos);
    return true;
  }

  // Compute a single, stable cinematic vantage from the kill geometry.
  _composeShot(threat) {
    // Victim heading at death (for fallbacks and so motion reads across screen).
    const vel = this._actorVelocity('player');

    // Direction from the victim toward whatever killed it ("line of action").
    const type = threat && threat.type;
    if (this.killerId) {
      const kp = this._actorAt(this.killerId, this.deathTime);
      if (kp) _line.copy(kp).sub(this.deathPos);
    } else if (type === 'sea') {
      _line.set(0, -1, 0); // the sea is below
    } else if (type === 'gun' && threat.dir) {
      _line.copy(threat.dir).negate(); // a bullet travels toward us; the shooter is opposite
    } else if (threat && threat.dir) {
      _line.copy(threat.dir);
    } else {
      _line.copy(vel).negate();
    }
    if (_line.lengthSq() < 1e-4) _line.copy(vel).negate();
    _line.normalize();
    this._lineDir = _line.clone();

    // Side axis: horizontal, perpendicular to the line of action. If the action
    // is near-vertical (e.g. diving into the sea) fall back to the victim's path.
    _side.crossVectors(UP, _line);
    if (_side.lengthSq() < 0.05) _side.crossVectors(UP, vel);
    if (_side.lengthSq() < 0.05) _side.set(1, 0, 0);
    _side.normalize();

    // Distance: close enough that the victim is large, scaled a little by how
    // far the attacker is so both can fit, but firmly capped.
    let killerDist = 0;
    if (this.killerId) {
      const kp = this._actorAt(this.killerId, this.deathTime);
      if (kp) killerDist = kp.distanceTo(this.deathPos);
    }
    const dist = THREE.MathUtils.clamp(killerDist * 0.5 + 30, 38, 78);
    this._dist = dist;

    // 3/4 kill-cam: behind the victim relative to the attacker (-line), off to
    // one side, and above. Looking at the victim, the attacker sits beyond it,
    // clearly in frame, with the impact happening centre-screen.
    this._camOffset.copy(UP).multiplyScalar(dist * 0.42)
      .addScaledVector(_side, dist * 0.5)
      .addScaledVector(_line, -dist * 0.72);
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

    let victimPos = null;
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
      if (id === 'player') victimPos = mesh.position;
    }

    // Track the victim (then hold on the impact point once it's gone).
    const subject = victimPos || this.deathPos;
    if (!this._started) { this.focus.copy(subject); this._started = true; }
    else this.focus.lerp(subject, Math.min(1, dt * 6));

    // Stable vantage that dollies in slightly toward the impact.
    const progress = THREE.MathUtils.clamp(
      (this.playTime - (this.deathTime - this.window)) / this.window, 0, 1);
    const zoom = THREE.MathUtils.lerp(1.06, 0.86, progress);
    this._desiredCam.copy(this.focus).addScaledVector(this._camOffset, zoom);
    if (camera.position.distanceTo(this._desiredCam) > 200) camera.position.copy(this._desiredCam);
    else camera.position.lerp(this._desiredCam, Math.min(1, dt * 5));
    camera.up.set(0, 1, 0);
    camera.lookAt(this.focus);
    camera.fov += (50 - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();

    // Re-stage the killing blow at the exact moment.
    if (!this.explosionFired && this.playTime >= this.deathTime) {
      this.fx.explosion(this.deathPos, { size: 13, color: 0xffae42 });
      this.explosionFired = true;
    }

    if (this.playTime >= this.deathTime + this.tail) { this.cleanup(); return true; }
    return false;
  }

  // ---- buffer sampling helpers ----
  _actorAt(id, t) {
    // Nearest recorded sample of an actor at/around time t (scans from the end).
    for (let k = this._frames.length - 1; k >= 0; k--) {
      const a = this._frames[k]._map.get(id);
      if (a && this._frames[k].t <= t + 1e-3) return _sample.set(a.px, a.py, a.pz);
    }
    // Otherwise the earliest sample we have.
    for (let k = 0; k < this._frames.length; k++) {
      const a = this._frames[k]._map.get(id);
      if (a) return _sample.set(a.px, a.py, a.pz);
    }
    return null;
  }

  _actorVelocity(id) {
    // Velocity from the last two recorded samples of an actor.
    const got = [];
    for (let k = this._frames.length - 1; k >= 0 && got.length < 2; k--) {
      const a = this._frames[k]._map.get(id);
      if (a) got.push({ p: new THREE.Vector3(a.px, a.py, a.pz), t: this._frames[k].t });
    }
    if (got.length === 2) {
      const v = got[0].p.sub(got[1].p);
      if (v.lengthSq() > 1e-5) return v.normalize();
    }
    return new THREE.Vector3(0, 0, 1);
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
