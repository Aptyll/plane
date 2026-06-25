import * as THREE from 'three';
import { Trail } from '../systems/effects.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function isAllyFaction(faction) {
  return faction === 'player' || faction === 'ally';
}

export class ProjectileManager {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.bullets = [];
    this.missiles = [];

    this._tracerGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6);
    this._tracerGeo.rotateX(Math.PI / 2);
    this._playerTracerMat = new THREE.MeshBasicMaterial({ color: 0x9bf0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this._enemyTracerMat = new THREE.MeshBasicMaterial({ color: 0xff7a4a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

    this._missileGeo = new THREE.CapsuleGeometry(0.18, 1.0, 4, 8);
    this._missileGeo.rotateX(Math.PI / 2);
    this._missileMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.4 });
  }

  spawnBullet(pos, dir, faction, speed = 520, damage = 9, sourceId = null) {
    const mat = isAllyFaction(faction) ? this._playerTracerMat : this._enemyTracerMat;
    const m = new THREE.Mesh(this._tracerGeo, mat);
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    this.scene.add(m);
    this.bullets.push({ mesh: m, vel: dir.clone().normalize().multiplyScalar(speed), life: 2.2, faction, damage, sourceId });
  }

  spawnMissile(pos, dir, faction, target, sourceId = null) {
    const m = new THREE.Mesh(this._missileGeo, this._missileMat);
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    this.scene.add(m);
    const trail = new Trail(this.scene, { length: 26, color: 0xffd9a0, width: 0.35, opacity: 0.8 });
    this.missiles.push({
      mesh: m, trail,
      vel: dir.clone().normalize().multiplyScalar(180),
      speed: 180, maxSpeed: 360,
      life: 5.5, faction, target, damage: 60, turn: 2.6, sourceId,
    });
  }

  update(dt, allies, enemies) {
    this._updateBullets(dt, allies, enemies);
    this._updateMissiles(dt, allies, enemies);
  }

  _updateBullets(dt, allies, enemies) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;

      let hit = false;
      if (isAllyFaction(b.faction)) {
        for (const e of enemies) {
          if (!e.alive) continue;
          if (b.mesh.position.distanceToSquared(e.group.position) < e.radius * e.radius) {
            e.takeDamage(b.damage, b.mesh.position.clone(), b.sourceId);
            hit = true; break;
          }
        }
      } else {
        for (const a of allies) {
          if (!a.alive) continue;
          if (b.mesh.position.distanceToSquared(a.group.position) < a.radius * a.radius) {
            a.takeDamage(b.damage, {
              type: 'gun',
              pos: b.mesh.position.clone(),
              dir: b.vel.clone().normalize(),
              sourceId: b.sourceId,
            });
            hit = true; break;
          }
        }
      }

      if (b.mesh.position.y < 0) { this.fx.explosion(b.mesh.position.clone(), { size: 2, color: 0x8fd0ff }); hit = true; }

      if (hit || b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }

  _updateMissiles(dt, allies, enemies) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;

      let tgt = m.target;
      if (isAllyFaction(m.faction) && (!tgt || !tgt.alive)) tgt = null;
      if (tgt && tgt.alive !== false) {
        const tpos = tgt.group ? tgt.group.position : tgt.position;
        _v.copy(tpos).sub(m.mesh.position).normalize();
        const fwd = _v2.set(0, 0, 1).applyQuaternion(m.mesh.quaternion);
        const q = new THREE.Quaternion().setFromUnitVectors(fwd, _v);
        const maxStep = m.turn * dt;
        const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
        if (angle > maxStep) q.slerp(new THREE.Quaternion(), 1 - maxStep / angle);
        m.mesh.quaternion.premultiply(q);
      }
      m.speed = Math.min(m.maxSpeed, m.speed + 240 * dt);
      const dir = _v.set(0, 0, 1).applyQuaternion(m.mesh.quaternion);
      m.mesh.position.addScaledVector(dir, m.speed * dt);

      const tail = _v2.copy(m.mesh.position).addScaledVector(dir, -0.8);
      m.trail.push(tail, new THREE.Vector3(0, 1, 0));

      let hit = false;
      if (isAllyFaction(m.faction)) {
        for (const e of enemies) {
          if (!e.alive) continue;
          if (m.mesh.position.distanceToSquared(e.group.position) < (e.radius + 2) * (e.radius + 2)) {
            e.takeDamage(m.damage, m.mesh.position.clone(), m.sourceId);
            hit = true; break;
          }
        }
      } else {
        for (const a of allies) {
          if (!a.alive) continue;
          if (m.mesh.position.distanceToSquared(a.group.position) < (a.radius + 2) * (a.radius + 2)) {
            a.takeDamage(m.damage, {
              type: 'missile',
              pos: m.mesh.position.clone(),
              dir: dir.clone(),
              sourceId: m.sourceId,
            });
            hit = true; break;
          }
        }
      }
      if (m.mesh.position.y < 0) hit = true;

      if (hit || m.life <= 0) {
        this.fx.explosion(m.mesh.position.clone(), { size: 7, color: 0xffae42 });
        this.scene.remove(m.mesh);
        m.trail.dispose();
        this.missiles.splice(i, 1);
      }
    }
  }
}
