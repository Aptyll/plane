import * as THREE from 'three';
import { buildJet } from './jetModel.js';
import { Trail, makeAfterburner, updateAfterburner } from '../systems/effects.js';

const FORWARD = new THREE.Vector3(0, 0, 1);

// Enemy fighter with simple but lively dogfight AI: pursue, circle, strafe,
// and break off when overshooting. Shares the procedural jet model.
export class Enemy {
  constructor(scene, projectiles, fx, pos, difficulty = 1) {
    this.scene = scene;
    this.projectiles = projectiles;
    this.fx = fx;

    this.group = buildJet({ body: 0x6b3030, accent: 0x301414, cockpit: 0x1a0a0a, emissive: 0x140000 });
    this.group.position.copy(pos);
    scene.add(this.group);

    this.alive = true;
    this.radius = 6;
    this.maxHp = 30 + difficulty * 10;
    this.hp = this.maxHp;
    this.speed = 55 + difficulty * 6;
    this.turnRate = 0.9 + difficulty * 0.12;
    this.fireCooldown = Math.random() * 2;
    this.fireRate = Math.max(0.12, 0.22 - difficulty * 0.01);
    this.burstLeft = 0;

    this.burner = makeAfterburner(false); // no point light — keep dynamic lights cheap
    this.group.userData.burner.add(this.burner);
    this.trail = new Trail(scene, { length: 24, color: 0xffd0d0, width: 0.3, opacity: 0.25 });

    this.state = 'pursue';
    this.stateTimer = 0;
    this._dir = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  get position() { return this.group.position; }

  update(dt, player, time) {
    if (!this.alive) return;
    this.stateTimer -= dt;

    const toPlayer = this._desired.copy(player.position).sub(this.group.position);
    const dist = toPlayer.length();
    toPlayer.normalize();

    this._dir.copy(FORWARD).applyQuaternion(this.group.quaternion);
    const facing = this._dir.dot(toPlayer); // 1 = pointing at player

    // State machine
    if (this.state === 'pursue') {
      if (dist < 90 && facing > 0.5) { this.state = 'strafe'; this.stateTimer = 1.2; }
      if (dist < 45) { this.state = 'break'; this.stateTimer = 1.6 + Math.random(); }
    } else if (this.state === 'strafe') {
      if (this.stateTimer <= 0 || dist > 160) this.state = 'pursue';
      if (dist < 40) { this.state = 'break'; this.stateTimer = 1.6; }
    } else if (this.state === 'break') {
      if (this.stateTimer <= 0) this.state = 'pursue';
    }

    // Desired heading
    let desired;
    if (this.state === 'break') {
      // Veer away to set up another pass
      desired = toPlayer.clone().multiplyScalar(-1);
      desired.x += Math.sin(time * 1.3 + this.group.id) * 0.6;
      desired.y += 0.25;
    } else {
      // Aim slightly ahead of player for an intercept feel
      desired = toPlayer.clone();
      if (this.state === 'strafe') desired.y += 0.05;
    }
    desired.normalize();

    // Avoid the sea
    if (this.group.position.y < 60) desired.y += (60 - this.group.position.y) * 0.02;
    if (this.group.position.y > 1200) desired.y -= 0.4;
    desired.normalize();

    // Steer toward desired heading. Matrix4.lookAt(eye, target, up) builds a
    // basis whose +Z = normalize(eye - target); with eye=0, target=-desired
    // that gives +Z = desired, which matches the jet's nose (+Z forward).
    const targetQ = this._q.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), desired.clone().negate(), new THREE.Vector3(0, 1, 0))
    );
    this.group.quaternion.slerp(targetQ, Math.min(1, this.turnRate * dt));

    // Move
    this._dir.copy(FORWARD).applyQuaternion(this.group.quaternion);
    this.group.position.addScaledVector(this._dir, this.speed * dt);
    if (this.group.position.y < 14) this.group.position.y = 14;

    // Fire when lined up
    this.fireCooldown -= dt;
    if (this.state !== 'break' && dist < 260 && facing > 0.985 && this.fireCooldown <= 0) {
      this._fire();
    }

    updateAfterburner(this.burner, 0.7, dt);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.group.quaternion);
    this.trail.push(this.group.position.clone().addScaledVector(this._dir, -2), up);
  }

  _fire() {
    if (this.burstLeft <= 0) { this.burstLeft = 3; }
    this.burstLeft--;
    this.fireCooldown = this.burstLeft > 0 ? this.fireRate : this.fireRate + 0.9;
    const muzzle = this.group.position.clone().addScaledVector(this._dir, 5);
    this.projectiles.spawnBullet(muzzle, this._dir.clone(), 'enemy', 360, 7);
  }

  takeDamage(amount, hitPos) {
    if (!this.alive) return;
    this.hp -= amount;
    if (hitPos) this.fx.explosion(hitPos, { size: 1.6, color: 0xffd27f });
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.fx.explosion(this.group.position.clone(), { size: 10, color: 0xffae42 });
    this.scene.remove(this.group);
    this.trail.dispose();
    if (this.onDeath) this.onDeath(this);
  }
}
