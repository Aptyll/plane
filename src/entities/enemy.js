import * as THREE from 'three';
import { buildJet, LIVERY } from './jetModel.js';
import { Trail, makeAfterburner, updateAfterburner } from '../systems/effects.js';

const FORWARD = new THREE.Vector3(0, 0, 1);

const CALLSIGNS = [
  'Crimson Fang', 'Iron Talon', 'Storm Viper', 'Ghost Hawk', 'Blood Raven',
  'Night Striker', 'Steel Falcon', 'Ember Wing', 'Shadow Ace', 'Void Dart',
  'Scarlet Bolt', 'Onyx Kite',
];

// Enemy fighter with simple but lively dogfight AI: pursue, circle, strafe,
// and break off when overshooting. Shares the procedural jet model.
export class Enemy {
  constructor(scene, projectiles, fx, pos, difficulty = 1, squadIndex = 0) {
    this.scene = scene;
    this.projectiles = projectiles;
    this.fx = fx;

    this.group = buildJet(LIVERY.red); // Warcraft red
    this.group.position.copy(pos);
    scene.add(this.group);

    this.alive = true;
    this.radius = 6;
    this.maxHp = 30 + difficulty * 10;
    this.hp = this.maxHp;
    this.minSpeed = 40;
    this.maxSpeed = 130;
    this.displayName = CALLSIGNS[squadIndex % CALLSIGNS.length];
    this.team = 'enemy';
    this.id = 'E' + this.group.id;
    this.lastDamagerId = null;
    this.level = Math.max(1, Math.floor(difficulty));
    this.xp = 0;
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
    this._sep = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  get position() { return this.group.position; }

  forward(out = new THREE.Vector3()) { return out.copy(FORWARD).applyQuaternion(this.group.quaternion); }

  _normalizeAllies(allies) {
    if (Array.isArray(allies)) return allies;
    if (allies && typeof allies.alive === 'boolean') return [allies];
    return [];
  }

  _entityPos(entity) {
    if (!entity?.group?.position) return null;
    return entity.group.position;
  }

  update(dt, allies, time, squadron) {
    if (!this.alive || !this.group?.position) return;
    this.stateTimer -= dt;

    const allyList = this._normalizeAllies(allies);
    let target = null;
    let bestDist = Infinity;
    for (const a of allyList) {
      if (!a?.alive) continue;
      const pos = this._entityPos(a);
      if (!pos) continue;
      const d = this.group.position.distanceTo(pos);
      if (d < bestDist) { bestDist = d; target = a; }
    }
    if (!target) return;

    const targetPos = this._entityPos(target);
    if (!targetPos) return;

    const toTarget = this._desired.copy(targetPos).sub(this.group.position);
    const dist = toTarget.length();
    toTarget.normalize();

    this._dir.copy(FORWARD).applyQuaternion(this.group.quaternion);
    const facing = this._dir.dot(toTarget);

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
      desired = toTarget.clone().multiplyScalar(-1);
      desired.x += Math.sin(time * 1.3 + this.group.id) * 0.6;
      desired.y += 0.25;
    } else {
      desired = toTarget.clone();
      if (this.state === 'strafe') desired.y += 0.05;
    }
    desired.normalize();

    // Avoid the sea
    if (this.group.position.y < 60) desired.y += (60 - this.group.position.y) * 0.02;
    if (this.group.position.y > 1200) desired.y -= 0.4;

    // Collision avoidance: steer away from nearby friendlies and the player so
    // aircraft don't simply fly through each other.
    if (squadron) {
      for (const o of squadron) {
        if (o === this || !o?.alive || !o.group?.position) continue;
        const d = this.group.position.distanceTo(o.group.position);
        if (d < 55 && d > 0.001) {
          const away = this._sep.copy(this.group.position).sub(o.group.position).divideScalar(d);
          desired.addScaledVector(away, (55 - d) / 55 * 0.9);
        }
      }
    }
    for (const a of allyList) {
      if (!a?.alive) continue;
      const pos = this._entityPos(a);
      if (!pos) continue;
      const d = this.group.position.distanceTo(pos);
      if (d < 35 && d > 0.001) {
        const away = this._sep.copy(this.group.position).sub(pos).divideScalar(d);
        desired.addScaledVector(away, (35 - d) / 35 * 1.1);
      }
    }
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
    // Flying into the sea destroys the aircraft.
    if (this.group.position.y <= 8) {
      this.fx.explosion(this.group.position.clone(), { size: 8, color: 0x9fd8ff });
      this.die();
      return;
    }

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
    this.projectiles.spawnBullet(muzzle, this._dir.clone(), 'enemy', 360, 7, this.id);
  }

  takeDamage(amount, hitPos, killerId = null) {
    if (!this.alive) return;
    if (killerId) this.lastDamagerId = killerId;
    this.hp -= amount;
    if (hitPos) this.fx.explosion(hitPos, { size: 1.6, color: 0xffd27f });
    if (killerId && this.onHit) this.onHit(killerId, amount);
    if (this.hp <= 0) this.die();
  }

  die(killerId = null) {
    if (!this.alive) return;
    this.alive = false;
    const credited = killerId ?? this.lastDamagerId;
    this.fx.explosion(this.group.position.clone(), { size: 10, color: 0xffae42 });
    this.scene.remove(this.group);
    this.trail.dispose();
    if (this.onDeath) this.onDeath(this, credited);
  }
}
