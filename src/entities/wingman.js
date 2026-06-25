import * as THREE from 'three';
import { buildJet, LIVERY } from './jetModel.js';
import { Trail, makeAfterburner, updateAfterburner } from '../systems/effects.js';

const FORWARD = new THREE.Vector3(0, 0, 1);

// AI wingman on the player's team — pursues and engages enemy fighters.
export class Wingman {
  constructor(scene, projectiles, fx, pos) {
    this.scene = scene;
    this.projectiles = projectiles;
    this.fx = fx;

    this.group = buildJet(LIVERY.blue);
    this.group.position.copy(pos);
    scene.add(this.group);

    this.id = 'W' + this.group.id;
    this.alive = true;
    this.radius = 5;
    this.maxHp = 80;
    this.hp = this.maxHp;
    this.minSpeed = 40;
    this.maxSpeed = 130;
    this.displayName = 'Valkyrie';
    this.team = 'ally';
    this.level = 1;
    this.xp = 0;
    this.speed = 72;
    this.turnRate = 1.05;
    this.fireCooldown = Math.random();
    this.fireRate = 0.16;
    this.burstLeft = 0;
    this.lastDamagerId = null;

    this.burner = makeAfterburner(false);
    this.group.userData.burner.add(this.burner);
    this.trail = new Trail(scene, { length: 28, color: 0xb8e8ff, width: 0.32, opacity: 0.3 });

    this.state = 'pursue';
    this.stateTimer = 0;
    this._dir = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._sep = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  get position() { return this.group.position; }

  forward(out = new THREE.Vector3()) { return out.copy(FORWARD).applyQuaternion(this.group.quaternion); }

  update(dt, enemies, time, allies) {
    if (!this.alive) return;
    if (!Array.isArray(enemies)) enemies = [];
    this.stateTimer -= dt;

    let target = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (!e?.alive || !e.group?.position) continue;
      const d = this.group.position.distanceTo(e.group.position);
      if (d < bestDist) { bestDist = d; target = e; }
    }
    if (!target?.group?.position) return;

    const toTarget = this._desired.copy(target.group.position).sub(this.group.position);
    const dist = toTarget.length();
    toTarget.normalize();

    this._dir.copy(FORWARD).applyQuaternion(this.group.quaternion);
    const facing = this._dir.dot(toTarget);

    if (this.state === 'pursue') {
      if (dist < 90 && facing > 0.5) { this.state = 'strafe'; this.stateTimer = 1.1; }
      if (dist < 45) { this.state = 'break'; this.stateTimer = 1.4 + Math.random(); }
    } else if (this.state === 'strafe') {
      if (this.stateTimer <= 0 || dist > 160) this.state = 'pursue';
      if (dist < 40) { this.state = 'break'; this.stateTimer = 1.4; }
    } else if (this.state === 'break') {
      if (this.stateTimer <= 0) this.state = 'pursue';
    }

    let desired;
    if (this.state === 'break') {
      desired = toTarget.clone().multiplyScalar(-1);
      desired.x += Math.sin(time * 1.2 + this.group.id) * 0.5;
      desired.y += 0.2;
    } else {
      desired = toTarget.clone();
      if (this.state === 'strafe') desired.y += 0.04;
    }
    desired.normalize();

    if (this.group.position.y < 60) desired.y += (60 - this.group.position.y) * 0.02;
    if (this.group.position.y > 1200) desired.y -= 0.4;

    if (allies) {
      for (const a of allies) {
        if (a === this || !a.alive) continue;
        const d = this.group.position.distanceTo(a.group.position);
        if (d < 50 && d > 0.001) {
          const away = this._sep.copy(this.group.position).sub(a.group.position).divideScalar(d);
          desired.addScaledVector(away, (50 - d) / 50 * 0.85);
        }
      }
    }
    desired.normalize();

    const targetQ = this._q.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), desired.clone().negate(), new THREE.Vector3(0, 1, 0))
    );
    this.group.quaternion.slerp(targetQ, Math.min(1, this.turnRate * dt));

    this._dir.copy(FORWARD).applyQuaternion(this.group.quaternion);
    this.group.position.addScaledVector(this._dir, this.speed * dt);

    if (this.group.position.y <= 8) {
      this.fx.explosion(this.group.position.clone(), { size: 8, color: 0x9fd8ff });
      this.die();
      return;
    }

    this.fireCooldown -= dt;
    if (this.state !== 'break' && dist < 280 && facing > 0.985 && this.fireCooldown <= 0) {
      this._fire();
    }

    updateAfterburner(this.burner, 0.75, dt);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    this.trail.push(this.group.position.clone().addScaledVector(this._dir, -2), up);
  }

  _fire() {
    if (this.burstLeft <= 0) this.burstLeft = 3;
    this.burstLeft--;
    this.fireCooldown = this.burstLeft > 0 ? this.fireRate : this.fireRate + 0.85;
    const muzzle = this.group.position.clone().addScaledVector(this._dir, 5);
    this.projectiles.spawnBullet(muzzle, this._dir.clone(), 'ally', 480, 8, this.id);
  }

  takeDamage(amount, hitPosOrThreat, killerId = null) {
    if (!this.alive) return;
    let hitPos = hitPosOrThreat;
    if (hitPosOrThreat && typeof hitPosOrThreat === 'object' && hitPosOrThreat.sourceId) {
      killerId = hitPosOrThreat.sourceId;
      hitPos = hitPosOrThreat.pos;
    }
    if (killerId) this.lastDamagerId = killerId;
    this.hp -= amount;
    if (hitPos) this.fx.explosion(hitPos, { size: 1.6, color: 0xffd27f });
    if (this.hp <= 0) this.die();
  }

  collide(point, other) {
    if (!this.alive) return;
    if (point) this.fx.explosion(point, { size: 12, color: 0xffae42 });
    const killerId = other?.id ?? null;
    this.takeDamage(this.maxHp * 2, point, killerId);
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    const killerId = this.lastDamagerId;
    this.fx.explosion(this.group.position.clone(), { size: 10, color: 0xffae42 });
    this.scene.remove(this.group);
    this.trail.dispose();
    if (this.onDeath) this.onDeath(this, killerId);
  }
}
