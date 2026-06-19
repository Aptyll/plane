import * as THREE from 'three';
import { Environment } from './world/environment.js';
import { Plane } from './entities/plane.js';
import { Enemy } from './entities/enemy.js';
import { ProjectileManager } from './entities/projectiles.js';
import { FXManager } from './systems/effects.js';
import { CameraRig } from './systems/cameraRig.js';
import { HUD } from './systems/hud.js';

export class Game {
  constructor(scene, camera, renderer, input) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.input = input;

    this.fx = new FXManager(scene);
    this.projectiles = new ProjectileManager(scene, this.fx);
    this.hud = new HUD();

    this.environment = new Environment(scene, renderer);

    this.enemies = [];
    this.running = false;
    this.score = 0;
    this.wave = 0;
    this._time = 0;
    this._tmp = new THREE.Vector3();

    this.onGameOver = null;

    // Synthetic input used to fly the jet on the attract/menu screen.
    this._demoInput = { steerX: 0, steerY: 0, throttle: 0, fire: false, missile: false, cameraNext: false };

    // Spawn a cruising jet + cinematic camera so the menu is alive.
    this._spawnPlayer();
    this.rig.setMode('cinematic');
  }

  _spawnPlayer() {
    if (this.plane) {
      this.scene.remove(this.plane.group);
      this.plane.trailL.dispose(); this.plane.trailR.dispose(); this.plane.damageTrail.dispose();
    }
    this.plane = new Plane(this.scene, this.projectiles, this.fx);
    this.plane.onDeath = () => this._gameOver();
    this.rig = new CameraRig(this.camera, this.plane);
  }

  start() {
    this.reset();
    this.rig.setMode('chase');
    this.running = true;
  }

  reset() {
    // Clear enemies + projectiles
    for (const e of this.enemies) { if (e.alive) { this.scene.remove(e.group); e.trail.dispose(); } }
    this.enemies = [];
    for (const b of this.projectiles.bullets) this.scene.remove(b.mesh);
    this.projectiles.bullets = [];
    for (const m of this.projectiles.missiles) { this.scene.remove(m.mesh); m.trail.dispose(); }
    this.projectiles.missiles = [];

    this._spawnPlayer();

    this.score = 0;
    this.wave = 0;
    this.currentTarget = null;
    this._nextWave();
  }

  _nextWave() {
    this.wave++;
    const count = Math.min(3 + this.wave, 9);
    const difficulty = 1 + (this.wave - 1) * 0.35;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 350 + Math.random() * 350;
      const pos = new THREE.Vector3(
        this.plane.position.x + Math.cos(a) * r,
        120 + Math.random() * 400,
        this.plane.position.z + Math.sin(a) * r
      );
      const e = new Enemy(this.scene, this.projectiles, this.fx, pos, difficulty);
      e.onDeath = (en) => this._onEnemyDeath(en);
      this.enemies.push(e);
    }
    this.hud.kill(`WAVE ${this.wave} INBOUND`);
  }

  _onEnemyDeath(enemy) {
    this.score += 100 + this.wave * 10;
    this.hud.kill('ENEMY DOWN +' + (100 + this.wave * 10));
    this.rig.addShake(0.3);
  }

  _gameOver() {
    this.running = false;
    if (this.onGameOver) this.onGameOver(this.score, this.wave);
  }

  _selectTarget() {
    // Nearest enemy within a forward cone — used for missile lock + HUD.
    const fwd = this.plane.forward(this._tmp).clone();
    let best = null, bestScore = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = e.group.position.clone().sub(this.plane.position);
      const dist = to.length();
      if (dist > 600) continue;
      to.normalize();
      const dot = fwd.dot(to);
      if (dot < 0.4) continue;
      const score = dot * 2 - dist / 600;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    this.currentTarget = best;
    this.plane.currentTarget = best;
  }

  update(dt, w, h) {
    this._time += dt;
    if (!this.running) {
      // Attract screen: gently fly the jet over the sea for a live backdrop.
      if (this.plane && this.plane.alive) {
        this._demoInput.steerX = Math.sin(this._time * 0.35) * 0.35;
        this._demoInput.steerY = Math.sin(this._time * 0.23) * 0.12;
        this.plane.throttle = 0.7;
        this.plane.update(dt, this._demoInput, this._time);
      }
      this.environment.update(dt, this.plane ? this.plane.position : new THREE.Vector3());
      this.fx.update(dt);
      this.projectiles.update(dt, this.plane, this.enemies);
      if (this.rig) this.rig.update(dt, this._time);
      return;
    }

    this.input.update();
    const st = this.input.state;
    if (st.cameraNext) {
      const label = this.rig.next();
      this.hud.kill('CAM: ' + label);
    }

    this.plane.update(dt, st, this._time);
    this._selectTarget();

    for (const e of this.enemies) e.update(dt, this.plane, this._time);
    this.projectiles.update(dt, this.plane, this.enemies);
    this.fx.update(dt);

    // Clean dead enemies, advance waves
    this.enemies = this.enemies.filter((e) => e.alive);
    if (this.enemies.length === 0) this._nextWave();

    this.environment.update(dt, this.plane.position);
    this.rig.update(dt, this._time);

    // HUD
    this.hud.setStats({
      score: this.score,
      wave: this.wave,
      enemies: this.enemies.length,
      hp: this.plane.hp,
      maxHp: this.plane.maxHp,
      throttle: this.plane.throttle,
      speed: this.plane.speed,
      minSpeed: this.plane.minSpeed,
      maxSpeed: this.plane.maxSpeed,
      alt: this.plane.position.y,
    });
    this.hud.updateTarget(this.currentTarget, this.camera, w, h);
  }
}
