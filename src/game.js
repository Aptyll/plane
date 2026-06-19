import * as THREE from 'three';
import { Environment } from './world/environment.js';
import { Plane } from './entities/plane.js';
import { Enemy } from './entities/enemy.js';
import { ProjectileManager } from './entities/projectiles.js';
import { FXManager } from './systems/effects.js';
import { CameraRig } from './systems/cameraRig.js';
import { HUD } from './systems/hud.js';
import { PilotAI } from './systems/pilot.js';
import { Replay } from './systems/replay.js';

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

    this.pilot = new PilotAI();
    this.autopilot = false;

    this.replay = new Replay(this.scene, this.fx);
    this.replaying = false;
    this._pendingDeath = false;
    this.onReplayStart = null;

    // Synthetic input used to fly the jet on the attract/menu screen.
    this._demoInput = { steerX: 0, steerY: 0, throttle: 0, fire: false, missile: false, cameraNext: false };

    // Spawn a cruising jet + steady menu camera so the menu is alive but calm.
    this._spawnPlayer();
    this.rig.setMode('menu');
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

  setAutopilot(on) {
    this.autopilot = on;
    this.pilot.reset();
    this.hud.setAutopilot(on);
  }

  reset() {
    this.replaying = false;
    this._pendingDeath = false;
    this.replay.resetBuffer();

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
    // Capture the death, then play it back next frame before the game-over UI.
    this._deathPos = this.plane.position.clone();
    this._deathTime = this._time;
    this._pendingDeath = true;
  }

  _startReplay() {
    // Clear transient live FX/projectiles and hide the live aircraft so only
    // the replay ghosts are shown.
    this.fx.clear();
    for (const b of this.projectiles.bullets) this.scene.remove(b.mesh);
    this.projectiles.bullets.length = 0;
    for (const m of this.projectiles.missiles) { this.scene.remove(m.mesh); m.trail.dispose(); }
    this.projectiles.missiles.length = 0;
    this.plane.group.visible = false;
    for (const e of this.enemies) e.group.visible = false;

    // Use the real recorded threat (shooter / collided plane / sea) to frame it.
    const ok = this.replay.begin(this._deathTime, this._deathPos, this.plane.lastThreat);
    if (!ok) { this._finishReplay(); return; }
    this.replaying = true;
    if (this.onReplayStart) this.onReplayStart();
  }

  skipReplay() {
    if (!this.replaying) return;
    this.replay.cleanup();
    this._finishReplay();
  }

  _finishReplay() {
    this.replaying = false;
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

  // Mid-air aircraft collisions are catastrophic for everyone involved.
  _handleCollisions() {
    const p = this.plane;
    const enemies = this.enemies;

    if (p.alive) {
      for (const e of enemies) {
        if (!e.alive) continue;
        const r = p.radius + e.radius;
        if (p.group.position.distanceToSquared(e.group.position) < r * r) {
          const mid = this._tmp.copy(p.group.position).lerp(e.group.position, 0.5);
          p.collide(mid, e); // record the threat before the enemy is removed
          e.die();
          if (this.rig) this.rig.addShake(0.9);
          break;
        }
      }
    }

    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (!b.alive) continue;
        const r = a.radius + b.radius;
        if (a.group.position.distanceToSquared(b.group.position) < r * r) {
          const mid = this._tmp.copy(a.group.position).lerp(b.group.position, 0.5);
          this.fx.explosion(mid, { size: 13, color: 0xffae42 });
          a.die();
          b.die();
          break;
        }
      }
    }
  }

  update(dt, w, h) {
    this._time += dt;

    // Death replay takes over the camera + scene until it finishes.
    if (this.replaying) {
      const done = this.replay.update(dt, this.camera);
      this.environment.update(dt, this.replay.focus);
      this.fx.update(dt);
      if (done) this._finishReplay();
      return;
    }
    if (this._pendingDeath) {
      this._pendingDeath = false;
      this._startReplay();
      return;
    }

    if (!this.running) {
      // Attract screen: fly the jet straight and level over the sea for a calm,
      // smooth backdrop — no circling, no jolting the camera.
      if (this.plane && this.plane.alive) {
        this.plane.crashEnabled = false; // never crash on the menu
        this._demoInput.steerX = 0;
        this._demoInput.steerY = 0;
        this.plane.throttle = 0.6;
        this.plane.update(dt, this._demoInput, this._time);
        // Hold a steady cruise altitude so it glides level (no slow sink/climb).
        this.plane.position.y += (200 - this.plane.position.y) * Math.min(1, dt * 0.6);
      }
      this.environment.update(dt, this.plane ? this.plane.position : new THREE.Vector3());
      this.fx.update(dt);
      this.projectiles.update(dt, this.plane, this.enemies);
      if (this.rig) this.rig.update(dt, this._time);
      return;
    }

    this.input.update();
    const st = this.input.state;
    if (st.autopilotToggle) {
      this.setAutopilot(!this.autopilot);
      this.hud.kill(this.autopilot ? 'AUTOPILOT ENGAGED' : 'MANUAL CONTROL');
    }
    if (st.cameraNext) {
      const label = this.rig.next();
      this.hud.kill('CAM: ' + label);
    }

    if (this.autopilot) {
      this.pilot.update(dt, this.plane, this.enemies, this._time);
      this.currentTarget = this.pilot.target;
    } else {
      this.plane.update(dt, st, this._time);
      this._selectTarget();
    }

    for (const e of this.enemies) e.update(dt, this.plane, this._time, this.enemies);
    this._handleCollisions();
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
    this.hud.updateRadar(this.plane, this.enemies, this.currentTarget, this._time);

    // Record this frame for a potential death replay.
    this.replay.record(this._time, this.plane, this.enemies);
  }
}
