import * as THREE from 'three';
import { Environment } from './world/environment.js';
import { Plane } from './entities/plane.js';
import { Enemy } from './entities/enemy.js';
import { Wingman } from './entities/wingman.js';
import { ProjectileManager } from './entities/projectiles.js';
import { FXManager } from './systems/effects.js';
import { CameraRig } from './systems/cameraRig.js';
import { HUD } from './systems/hud.js';
import { NameplateManager } from './systems/nameplates.js';
import { PilotAI } from './systems/pilot.js';
import { Replay } from './systems/replay.js';
import { grantXp, killXpReward, damageXpReward } from './systems/leveling.js';
import { DayCycle, MATCH_DURATION, RESPAWN_DELAY } from './systems/dayCycle.js';

export class Game {
  constructor(scene, camera, renderer, input) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.input = input;

    this.fx = new FXManager(scene);
    this.projectiles = new ProjectileManager(scene, this.fx);
    this.hud = new HUD();
    this.nameplates = new NameplateManager();

    this.environment = new Environment(scene, renderer);
    this.dayCycle = new DayCycle();

    this.enemies = [];
    this.wingman = null;
    this.running = false;
    this.matchActive = false;
    this.matchTime = 0;
    this.score = 0;
    this.wave = 0;
    this._waveTimer = 0;
    this._time = 0;
    this._tmp = new THREE.Vector3();

    this.onMatchEnd = null;
    this.onRespawnState = null;

    this.pilot = new PilotAI();
    this.autopilot = false;

    this.replay = new Replay(this.scene, this.fx);
    this.replaying = false;
    this._pendingDeath = false;
    this.playerDead = false;
    this.postReplay = false;
    this.spectating = false;
    this.respawnTimer = 0;

    this._demoInput = { steerX: 0, steerY: 0, throttle: 0, fire: false, missile: false, cameraNext: false };

    this._spawnPlayer();
    this.rig.setMode('menu');
  }

  _spawnPlayer() {
    if (this.plane) {
      this.scene.remove(this.plane.group);
      this.plane.trailL.dispose(); this.plane.trailR.dispose(); this.plane.damageTrail.dispose();
    }
    this.plane = new Plane(this.scene, this.projectiles, this.fx);
    this.plane.onDeath = () => {
      const killerId = this.plane.lastDamagerId ?? this.plane.lastThreat?.sourceId ?? null;
      this._onCombatantDeath(this.plane, killerId);
      this._onPlayerDeath();
    };
    this.rig = new CameraRig(this.camera, this.plane);
  }

  _spawnWingman() {
    if (this.wingman) {
      if (this.wingman.alive) {
        this.scene.remove(this.wingman.group);
        this.wingman.trail.dispose();
      }
      this.wingman = null;
    }
    const pos = this.plane.position.clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.plane.group.quaternion);
    const back = this.plane.forward(this._tmp).multiplyScalar(-1);
    pos.addScaledVector(right, -50).addScaledVector(back, 30);
    pos.y += 15;
    this.wingman = new Wingman(this.scene, this.projectiles, this.fx, pos);
    this.wingman.onDeath = (w, killerId) => this._onCombatantDeath(w, killerId);
  }

  _allies() {
    const list = [];
    if (this.plane?.alive && this.plane.group) list.push(this.plane);
    if (this.wingman?.alive && this.wingman.group) list.push(this.wingman);
    return list;
  }

  _allyFrames() {
    const list = [];
    if (this.plane) list.push(this.plane);
    if (this.wingman) list.push(this.wingman);
    return list;
  }

  _getCombatant(id) {
    if (!id) return null;
    if (this.plane?.id === id) return this.plane;
    if (this.wingman?.id === id) return this.wingman;
    for (const e of this.enemies) if (e.id === id) return e;
    return null;
  }

  _onCombatantDeath(victim, killerId = null) {
    const killer = this._getCombatant(killerId);
    if (victim.team === 'enemy') {
      this.score += 100 + this.wave * 10;
      if (this.rig) this.rig.addShake(0.3);
      if (killer?.team === 'ally') grantXp(killer, killXpReward(victim.level));
    }
    this.hud.logElimination({ killer, victim });
  }

  _awardDamageXp(attackerId, amount) {
    const attacker = this._getCombatant(attackerId);
    if (!attacker || attacker.team !== 'ally') return;
    grantXp(attacker, damageXpReward(amount));
  }

  start() {
    this.reset();
    this.rig.setMode('chase');
    this.running = true;
    this.matchActive = true;
    this.matchTime = 0;
    this._emitRespawnState('hidden');
  }

  setAutopilot(on) {
    this.autopilot = on;
    this.pilot.reset();
    this.hud.setAutopilot(on);
  }

  toggleDayCyclePause() {
    if (this.matchActive) return this.dayCycle.paused;
    return this.dayCycle.togglePause();
  }

  _tickDayCycle() {
    const phase = this.dayCycle.setFromMatchTime(this.matchTime);
    this.environment.setDayPhase(phase);
    const progress = Math.min(1, this.matchTime / MATCH_DURATION);
    this.hud.setDayCycle(phase, false, progress);
    this.hud.setMatchTimer(MATCH_DURATION - this.matchTime);
  }

  reset() {
    this.replaying = false;
    this._pendingDeath = false;
    this.playerDead = false;
    this.postReplay = false;
    this.spectating = false;
    this.respawnTimer = 0;
    this.matchActive = false;
    this.matchTime = 0;
    this._waveTimer = 0;
    this.replay.resetBuffer();

    for (const e of this.enemies) { if (e.alive) { this.scene.remove(e.group); e.trail.dispose(); } }
    this.enemies = [];
    if (this.wingman) {
      if (this.wingman.alive) {
        this.scene.remove(this.wingman.group);
        this.wingman.trail.dispose();
      }
      this.wingman = null;
    }
    for (const b of this.projectiles.bullets) this.scene.remove(b.mesh);
    this.projectiles.bullets = [];
    for (const m of this.projectiles.missiles) { this.scene.remove(m.mesh); m.trail.dispose(); }
    this.projectiles.missiles = [];

    this._spawnPlayer();
    this._spawnWingman();

    this.score = 0;
    this.wave = 0;
    this.currentTarget = null;
    this.nameplates.clear();
    this.hud.clearKillfeed();
    this.hud.clearAllyFrames();
    this._nextWave();
    this._tickDayCycle();
  }

  _nextWave() {
    this.wave++;
    const count = Math.min(2 + this.wave, 7);
    const difficulty = 1 + (this.wave - 1) * 0.28;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 350 + Math.random() * 350;
      const anchor = this.plane?.alive ? this.plane.position : (this.wingman?.group?.position ?? new THREE.Vector3());
      const pos = new THREE.Vector3(
        anchor.x + Math.cos(a) * r,
        120 + Math.random() * 400,
        anchor.z + Math.sin(a) * r,
      );
      const e = new Enemy(this.scene, this.projectiles, this.fx, pos, difficulty, i);
      e.level = Math.max(1, this.wave + Math.floor(difficulty * 0.35));
      e.onDeath = (en, killerId) => this._onCombatantDeath(en, killerId);
      e.onHit = (killerId, amount) => this._awardDamageXp(killerId, amount);
      this.enemies.push(e);
    }
    this._waveTimer = 0;
  }

  _onPlayerDeath() {
    if (!this.matchActive || this.playerDead) return;
    this.playerDead = true;
    this.spectating = false;
    this.postReplay = false;
    this.respawnTimer = RESPAWN_DELAY;
    this._deathPos = this.plane.position.clone();
    this._deathTime = this._time;
    this._deathThreat = this.plane.lastThreat;
    if (this.plane.group) this.plane.group.visible = false;
    this._pendingDeath = true;
    this._emitRespawnState('replay');
  }

  _startReplay() {
    this.fx.clear();
    for (const b of this.projectiles.bullets) this.scene.remove(b.mesh);
    this.projectiles.bullets.length = 0;
    for (const m of this.projectiles.missiles) { this.scene.remove(m.mesh); m.trail.dispose(); }
    this.projectiles.missiles.length = 0;
    if (this.plane?.group) this.plane.group.visible = false;
    if (this.wingman?.group) this.wingman.group.visible = false;
    for (const e of this.enemies) e.group.visible = false;
    this.nameplates.clear();

    const ok = this.replay.begin(this._deathTime, this._deathPos, this._deathThreat);
    if (!ok) { this._finishReplay(); return; }
    this.replaying = true;
    this.postReplay = false;
    this.spectating = false;
    this._emitRespawnState('replay');
  }

  watchReplayAgain() {
    if (!this.playerDead || this.replaying) return;
    this.spectating = false;
    this._startReplay();
  }

  spectateAlly() {
    if (!this.playerDead || this.replaying || !this.wingman?.alive) return;
    this.spectating = true;
    this.postReplay = true;
    this.rig.setTarget(this.wingman);
    this.rig.setMode('spectate');
    this._emitRespawnState(this.postReplay ? 'spectate' : 'choices');
  }

  skipReplay() {
    if (!this.replaying) return;
    this.replay.cleanup();
    this._finishReplay();
  }

  _finishReplay() {
    this.replaying = false;
    this.postReplay = true;
    this._restoreLiveScene();
    if (this.wingman?.alive) this.spectateAlly();
    else this._emitRespawnState('choices');
  }

  _restoreLiveScene() {
    if (this.wingman?.alive) this.wingman.group.visible = true;
    for (const e of this.enemies) if (e.alive) e.group.visible = true;
  }

  _respawnPlayer() {
    if (!this.matchActive) return;
    const pos = this._pickRespawnPos();
    this._spawnPlayer();
    this.plane.group.position.copy(pos);
    this.plane.hp = this.plane.maxHp;
    this.plane.alive = true;
    this.playerDead = false;
    this.postReplay = false;
    this.spectating = false;
    this.respawnTimer = 0;
    this.rig.setTarget(this.plane);
    this.rig.setMode('chase');
    this._emitRespawnState('hidden');
  }

  _pickRespawnPos() {
    if (this.wingman?.alive) {
      const p = this.wingman.group.position.clone();
      const back = new THREE.Vector3(0, 0, -1).applyQuaternion(this.wingman.group.quaternion);
      p.addScaledVector(back, -35);
      p.y = Math.max(120, p.y);
      return p;
    }
    return this._deathPos?.clone() ?? new THREE.Vector3(0, 160, 0);
  }

  _endMatch() {
    if (!this.matchActive) return;
    this.matchActive = false;
    this.running = false;
    this.replaying = false;
    this.replay.cleanup();
    this.playerDead = false;
    this._emitRespawnState('hidden');
    if (this.onMatchEnd) this.onMatchEnd(this.score, this.wave);
  }

  _emitRespawnState(phase) {
    if (!this.onRespawnState) return;
    this.onRespawnState({
      phase,
      respawnSec: Math.ceil(Math.max(0, this.respawnTimer)),
      canSpectate: !!this.wingman?.alive,
    });
  }

  _tickRespawn(dt) {
    if (!this.playerDead) return;
    this.respawnTimer = Math.max(0, this.respawnTimer - dt);
    this._emitRespawnState(
      this.replaying ? 'replay' : (this.spectating ? 'spectate' : 'choices'),
    );
  }

  _selectTarget() {
    if (!this.plane?.alive) return;
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

  _handleCollisions() {
    const allies = this._allies();
    const enemies = this.enemies;

    for (const a of allies) {
      if (!a.alive) continue;
      for (const e of enemies) {
        if (!e.alive) continue;
        const r = a.radius + e.radius;
        if (a.group.position.distanceToSquared(e.group.position) < r * r) {
          const mid = this._tmp.copy(a.group.position).lerp(e.group.position, 0.5);
          a.collide(mid, e);
          e.die(a.id);
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

  _simulateWorld(dt, w, h) {
    const allies = this._allies();

    if (this.wingman?.alive) {
      this.wingman.update(dt, this.enemies, this._time, allies);
    }

    for (const e of this.enemies) {
      if (!e?.alive) continue;
      e.update(dt, this._allies(), this._time, this.enemies);
    }

    this._handleCollisions();
    this.projectiles.update(dt, allies, this.enemies);
    this.fx.update(dt);

    this.enemies = this.enemies.filter((e) => e.alive);
    this._waveTimer += dt;
    if (this.enemies.length === 0 || this._waveTimer >= 38) {
      if (!this.wingman?.alive) this._spawnWingman();
      this._nextWave();
    }

    const focus = this.plane?.alive
      ? this.plane.position
      : (this.wingman?.alive ? this.wingman.group.position : new THREE.Vector3());
    this.environment.update(dt, focus);

    const camTarget = this.spectating && this.wingman?.alive
      ? this.wingman
      : (this.plane?.alive ? this.plane : this.wingman);
    if (camTarget?.alive && (this.spectating || !this.playerDead)) {
      this.rig.update(dt, this._time);
    }

    this.hud.setStats({
      score: this.score,
      hp: this.plane?.alive ? this.plane.hp : 0,
      maxHp: this.plane?.maxHp ?? 100,
    });
    this.hud.updateAllyFrames(this._allyFrames());
    this.hud.setMatchTimer(MATCH_DURATION - this.matchTime);

    const showPlayer = !this.playerDead && this.rig.mode !== 'cockpit';
    const radarPlayer = this.plane?.alive ? this.plane : this.wingman;
    if (radarPlayer) {
      const wingmanBlips = this.wingman?.alive && this.plane?.alive && radarPlayer === this.plane
        ? [this.wingman]
        : [];
      this.hud.updateRadar(
        radarPlayer,
        this.enemies,
        wingmanBlips,
        this.playerDead ? null : this.currentTarget,
        this.camera,
      );
    }

    this.nameplates.update({
      player: showPlayer ? this.plane : null,
      allies: this.wingman?.alive ? [this.wingman] : [],
      enemies: this.enemies,
      camera: this.camera,
      w, h,
      currentTarget: this.playerDead ? null : this.currentTarget,
      showPlayer,
    });
  }

  update(dt, w, h) {
    this._time += dt;

    if (this.matchActive) {
      this.matchTime += dt;
      this._tickDayCycle();
      if (this.matchTime >= MATCH_DURATION) {
        this._endMatch();
        return;
      }
    } else if (!this.running) {
      if (this.plane && this.plane.alive) {
        this.plane.crashEnabled = false;
        this._demoInput.steerX = 0;
        this._demoInput.steerY = 0;
        this.plane.throttle = 0.6;
        this.plane.update(dt, this._demoInput, this._time);
        this.plane.position.y += (200 - this.plane.position.y) * Math.min(1, dt * 0.6);
      }
      const phase = this.dayCycle.setFromMatchTime(0);
      this.environment.setDayPhase(phase);
      this.environment.update(dt, this.plane ? this.plane.position : new THREE.Vector3());
      this.fx.update(dt);
      this.projectiles.update(dt, this._allies(), this.enemies);
      if (this.rig) this.rig.update(dt, this._time);
      this.nameplates.update({
        player: this.plane,
        allies: this.wingman?.alive ? [this.wingman] : [],
        enemies: this.enemies,
        camera: this.camera,
        w, h,
        currentTarget: null,
        showPlayer: this.rig?.mode !== 'cockpit',
      });
      return;
    }

    if (this.replaying) {
      const done = this.replay.update(dt, this.camera);
      this._tickRespawn(dt);
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

    if (this.playerDead) {
      this._tickRespawn(dt);
      if (this.spectating) {
        if (!this.wingman?.alive) this.spectating = false;
        else {
          this.rig.setTarget(this.wingman);
          this.rig.setMode('spectate');
        }
      }
      this._simulateWorld(dt, w, h);
      if (this.playerDead && this.respawnTimer <= 0) this._respawnPlayer();
      return;
    }

    this.input.update();
    const st = this.input.state;
    if (st.autopilotToggle) this.setAutopilot(!this.autopilot);
    if (st.cameraNext) this.rig.next();

    const allies = this._allies();

    if (this.autopilot) {
      this.pilot.update(dt, this.plane, this.enemies, this._time);
      this.currentTarget = this.pilot.target;
    } else {
      this.plane.update(dt, st, this._time);
      this._selectTarget();
    }

    this._simulateWorld(dt, w, h);
    this.hud.updateTarget(this.currentTarget, this.camera, w, h);
    this.replay.record(this._time, this.plane, this.wingman, this.enemies);
  }
}
