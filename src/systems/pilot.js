import * as THREE from 'three';

// Autonomous fighter pilot. Drives the player's jet with lead-pursuit gunnery,
// missile locks, energy-aware throttle, hard banking turns, sea/altitude safety,
// and occasional barrel-roll flair / evasive rolls — built for spectating.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class PilotAI {
  constructor() {
    this.target = null;
    this.maneuver = null;   // { type, t, dur }
    this.rollPhase = 0;
    this.flairTimer = 8 + Math.random() * 6;

    this._desired = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  reset() {
    this.target = null;
    this.maneuver = null;
    this.rollPhase = 0;
    this.flairTimer = 8 + Math.random() * 6;
  }

  update(dt, plane, enemies, time) {
    this.flairTimer -= dt;

    const target = this._pickTarget(plane, enemies);
    this.target = target;
    plane.currentTarget = target; // so launched missiles home on it

    const pos = plane.position;
    const fwd = plane.forward(this._fwd);
    const right = this._right.set(1, 0, 0).applyQuaternion(plane.group.quaternion);

    const desired = this._desired;
    let throttleTarget = 1.0;
    let wantGun = false;
    let wantMissile = false;
    let combatClose = false;

    if (target) {
      const tp = target.group.position;
      // Estimate target velocity for a lead solution.
      const tvel = target._dir ? _a.copy(target._dir).multiplyScalar(target.speed) : _a.set(0, 0, 0);
      const toT = _b.copy(tp).sub(pos);
      const dist = toT.length();
      combatClose = dist < 260;

      const bulletSpeed = 520;
      const tHit = Math.min(2.2, dist / bulletSpeed);
      this._aim.copy(tp).addScaledVector(tvel, tHit);
      desired.copy(this._aim).sub(pos).normalize();

      const aimDot = fwd.dot(desired);                 // alignment to lead point
      const losDot = fwd.dot(_b.copy(tp).sub(pos).normalize()); // alignment to target

      // Energy management: ease off the throttle when closing so we don't
      // overshoot, firewall it when extending or chasing.
      if (dist < 70) throttleTarget = 0.4;
      else if (dist < 150) throttleTarget = 0.72;
      else throttleTarget = 1.0;
      if (dist < 60 && losDot < 0.1) throttleTarget = 0.32; // overshooting -> tighten

      // Guns when the lead solution is on the nose and in range.
      if (aimDot > 0.9975 && dist < 380) wantGun = true;
      // Missiles for committed head-on / pursuit shots at range.
      if (losDot > 0.96 && dist > 130 && dist < 800) wantMissile = true;
    } else {
      // No targets: cruise and gently level out.
      desired.copy(fwd);
      desired.y *= 0.6;
      desired.normalize();
      throttleTarget = 0.85;
    }

    // Altitude safety — climb away from the sea, push down from the ceiling.
    if (pos.y < 110) desired.y += (110 - pos.y) * 0.012;
    if (pos.y > 1300) desired.y -= (pos.y - 1300) * 0.012;
    desired.normalize();

    // Bank into the turn: roll toward the side the nose needs to swing.
    const lateral = right.dot(desired);
    let bankAngle = THREE.MathUtils.clamp(-lateral * 2.6, -1.35, 1.35);

    // ---- Maneuvers / flair ----
    // Evasive roll right after taking a hit (lastHitTime is on the perf clock).
    const sinceHit = performance.now() / 1000 - plane.lastHitTime;
    if (!this.maneuver && sinceHit < 0.2 && Math.random() < 0.6) {
      this.maneuver = { type: 'roll', t: 0.9, dur: 0.9 };
      this.rollPhase = 0;
    }
    // Show-off barrel roll when not in a close fight.
    if (!this.maneuver && this.flairTimer <= 0 && !combatClose) {
      this.maneuver = { type: 'roll', t: 1.15, dur: 1.15 };
      this.rollPhase = 0;
      this.flairTimer = 10 + Math.random() * 9;
    }

    if (this.maneuver) {
      if (this.maneuver.type === 'roll') {
        this.rollPhase += dt * (Math.PI * 2 / this.maneuver.dur);
        bankAngle = this.rollPhase; // full 360° aileron roll about the flight path
        throttleTarget = Math.max(throttleTarget, 0.9);
      }
      this.maneuver.t -= dt;
      if (this.maneuver.t <= 0) { this.maneuver = null; this.rollPhase = 0; }
    }

    plane.autoFly(dt, desired, bankAngle, throttleTarget, time);
    if (wantGun) plane.tryFireGun();
    if (wantMissile) plane.tryFireMissile();
  }

  // Prefer nearby enemies that are in front; sticky enough to commit to a kill.
  _pickTarget(plane, enemies) {
    const pos = plane.position;
    const fwd = plane.forward(this._fwd);
    let best = null, bestScore = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const to = _a.copy(e.group.position).sub(pos);
      const dist = to.length();
      to.normalize();
      const dot = fwd.dot(to);
      // Lower is better: closeness weighted by how far off the nose it is.
      const score = dist * (1.35 - dot * 0.6) + (e === this.target ? -120 : 0);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }
}
