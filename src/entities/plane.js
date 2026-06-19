import * as THREE from 'three';
import { buildJet } from './jetModel.js';
import { Trail, makeAfterburner, updateAfterburner } from '../systems/effects.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// Player-controlled fighter with arcade flight physics, banked turns,
// afterburner, wingtip contrails and gun/missile weapons.
export class Plane {
  constructor(scene, projectiles, fx) {
    this.scene = scene;
    this.projectiles = projectiles;
    this.fx = fx;

    this.group = buildJet({ body: 0xd7dde3, accent: 0x2c3742, cockpit: 0x0e1c28 });
    this.group.position.set(0, 160, 0);
    scene.add(this.group);

    // Flight state
    this.throttle = 0.6;
    this.minSpeed = 28;
    this.maxSpeed = 135;
    this.speed = 80;
    this.alive = true;
    this.radius = 5;

    this.maxHp = 100;
    this.hp = this.maxHp;

    // Weapons
    this.fireCooldown = 0;
    this.fireRate = 0.09;
    this.missileCooldown = 0;
    this.missileRate = 1.1;
    this._muzzleSide = 1;

    // Effects
    this.burner = makeAfterburner();
    this.group.userData.burner.add(this.burner);
    this.trailL = new Trail(scene, { length: 36, color: 0xcfeaff, width: 0.35, opacity: 0.35 });
    this.trailR = new Trail(scene, { length: 36, color: 0xcfeaff, width: 0.35, opacity: 0.35 });

    // Smoke when damaged
    this.damageTrail = new Trail(scene, { length: 30, color: 0x222222, width: 0.6, opacity: 0.0 });

    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.lastHitTime = -10;
  }

  get position() { return this.group.position; }

  forward(out = new THREE.Vector3()) { return out.copy(FORWARD).applyQuaternion(this.group.quaternion); }

  update(dt, input, time) {
    if (!this.alive) { this._updateEffects(dt, time); return; }

    // ----- Throttle -----
    this.throttle = THREE.MathUtils.clamp(this.throttle + input.throttle * dt * 0.7, 0, 1);
    const targetSpeed = THREE.MathUtils.lerp(this.minSpeed, this.maxSpeed, this.throttle);
    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, 1 - Math.pow(0.1, dt));

    // ----- Attitude (arcade flight) -----
    const pitchRate = 1.5;
    const rollRate = 2.6;
    const yawRate = 0.5;

    const pitch = input.steerY * pitchRate * dt;       // stick up => nose up
    const roll = -input.steerX * rollRate * dt;
    // Banked turn: yaw proportional to current bank angle for natural turning.
    const right = RIGHT.clone().applyQuaternion(this.group.quaternion);
    const bank = -right.y; // +1 banked right
    const yaw = (bank * 1.4 + input.steerX * yawRate) * dt;

    const qPitch = new THREE.Quaternion().setFromAxisAngle(RIGHT, pitch);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(FORWARD, roll);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, -yaw);

    this.group.quaternion.multiply(qPitch).multiply(qRoll);
    this.group.quaternion.premultiply(qYaw); // yaw in world up keeps turns level-ish
    this.group.quaternion.normalize();

    // Gentle auto-level of roll when no roll input (assist for pad/touch).
    if (Math.abs(input.steerX) < 0.05) {
      const levelQ = new THREE.Quaternion().setFromAxisAngle(FORWARD, bank * 0.6 * dt);
      this.group.quaternion.multiply(levelQ);
    }

    // ----- Translate -----
    this.forward(this._dir);
    this.group.position.addScaledVector(this._dir, this.speed * dt);

    // Slight gravity sink reduces with speed/throttle (keeps it grounded-feeling).
    this.group.position.y -= (1 - this.throttle) * 6 * dt;

    // Keep above the sea — clip + damage if scraping.
    if (this.group.position.y < 12) {
      this.group.position.y = 12;
      if (this.speed > 60) this.takeDamage(40 * dt);
    }
    if (this.group.position.y > 1500) this.group.position.y = 1500;

    // ----- Weapons -----
    this.fireCooldown -= dt;
    this.missileCooldown -= dt;
    if (input.fire && this.fireCooldown <= 0) this._fireGun();
    if (input.missile && this.missileCooldown <= 0) this._fireMissile();

    this._updateEffects(dt, time);
  }

  _fireGun() {
    this.fireCooldown = this.fireRate;
    this.forward(this._dir);
    const right = RIGHT.clone().applyQuaternion(this.group.quaternion);
    // Alternate wingtip muzzles
    const muzzle = this.group.position.clone()
      .addScaledVector(this._dir, 4.5)
      .addScaledVector(right, this._muzzleSide * 4.0);
    this._muzzleSide *= -1;
    this.projectiles.spawnBullet(muzzle, this._dir.clone(), 'player');
  }

  _fireMissile() {
    this.missileCooldown = this.missileRate;
    this.forward(this._dir);
    const right = RIGHT.clone().applyQuaternion(this.group.quaternion);
    const muzzle = this.group.position.clone()
      .addScaledVector(this._dir, 2)
      .addScaledVector(right, this._muzzleSide * 4.0)
      .add(new THREE.Vector3(0, -0.5, 0));
    const target = this.currentTarget && this.currentTarget.alive ? this.currentTarget : null;
    this.projectiles.spawnMissile(muzzle, this._dir.clone(), 'player', target);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastHitTime = performance.now() / 1000;
    if (this.hp <= 0) { this.hp = 0; this._die(); }
  }

  _die() {
    this.alive = false;
    this.fx.explosion(this.group.position.clone(), { size: 12, color: 0xffae42 });
    this.group.visible = false;
    if (this.onDeath) this.onDeath();
  }

  _updateEffects(dt, time) {
    updateAfterburner(this.burner, this.throttle, dt);

    // Wingtip contrails
    const right = RIGHT.clone().applyQuaternion(this.group.quaternion);
    const up = UP.clone().applyQuaternion(this.group.quaternion);
    this.forward(this._dir);
    const back = this.group.position.clone().addScaledVector(this._dir, -0.5);
    this.trailL.push(back.clone().addScaledVector(right, 4.2), up);
    this.trailR.push(back.clone().addScaledVector(right, -4.2), up);

    // Damage smoke
    const dmg = 1 - this.hp / this.maxHp;
    this.damageTrail.mat.opacity = dmg > 0.55 ? (dmg - 0.55) * 1.6 : 0;
    if (dmg > 0.55) this.damageTrail.push(this.group.position.clone().addScaledVector(this._dir, -2), up);
  }
}
