import * as THREE from 'three';

// Manages DOM HUD elements: score, reticle, radar, kill feed, and damage feedback.
export class HUD {
  constructor() {
    this.el = {
      score: document.getElementById('hud-score'),
      lead: document.getElementById('lead-marker'),
      arrow: document.getElementById('target-arrow'),
      vignette: document.getElementById('damage-vignette'),
      hitflash: document.getElementById('hitflash'),
      killfeed: document.getElementById('killfeed'),
      reticle: document.getElementById('reticle'),
      apBtn: document.getElementById('btn-autopilot'),
      apState: document.getElementById('ap-state'),
      allyBar: document.getElementById('ally-bar'),
      cycleBtn: document.getElementById('btn-daycycle'),
      cycleRing: document.getElementById('cycle-ring'),
      matchTimer: document.getElementById('match-timer'),
    };
    this._cycleRingLen = 2 * Math.PI * 17;
    this._allyFrames = new Map();
    this._jetIcon = `<svg class="ally-icon" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3 8 14h4l-1 9 5-4 5 4-1-9h4L16 3zm0 6.2 3.4 5.4h-6.8L16 9.2z"/></svg>`;
    this._lastHp = 100;
    this._v = new THREE.Vector3();

    // Radar
    this.radar = document.getElementById('radar');
    this.radarCtx = this.radar ? this.radar.getContext('2d') : null;
    this.radarRange = 1000; // world units mapped to radar edge
    this._fwd = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._blipR = 4.5;
    this._blipEdgeR = 3;
    this._targetR = 5.5;
    this._targetRingR = 10;
    this._playerR = 5;
  }

  _toRadarPos(dx, dz, fx, fz, cx, cy, R) {
    const relF = dx * fx + dz * fz;
    const relR = dx * fz - dz * fx;
    let bx = (relR / this.radarRange) * R;
    let by = -(relF / this.radarRange) * R;
    const d = Math.hypot(bx, by);
    let edge = false;
    if (d > R) { const k = R / d; bx *= k; by *= k; edge = true; }
    return { px: cx + bx, py: cy + by, edge };
  }

  _drawViewport(ctx, cx, cy, R, fx, fz, camera) {
    if (!camera) return;
    camera.getWorldDirection(this._camDir);
    let dx = this._camDir.x;
    let dz = this._camDir.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.12) return;
    dx /= len;
    dz /= len;

    const camRelF = dx * fx + dz * fz;
    const camRelR = dx * fz - dz * fx;
    const center = Math.atan2(-camRelF, camRelR);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
    const half = hFov * 0.5;
    const reach = R * 0.92;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, reach, center - half, center + half);
    ctx.closePath();
    ctx.fillStyle = 'rgba(79, 209, 255, 0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(110, 225, 255, 0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Top-down radar, nose-up: forward = up, allies blue, enemies red.
  updateRadar(player, enemies, allies, target, camera) {
    const ctx = this.radarCtx;
    if (!ctx || !player) return;
    const W = this.radar.width, H = this.radar.height;
    const cx = W / 2, cy = H / 2;
    const R = W / 2 - 8;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

    // Backdrop wash
    ctx.fillStyle = 'rgba(6,20,34,0.55)';
    ctx.fillRect(0, 0, W, H);

    // Range rings + crosshair
    ctx.strokeStyle = 'rgba(79,209,255,0.22)';
    ctx.lineWidth = 1;
    for (const f of [0.34, 0.67, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath();
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.stroke();

    // Player heading in XZ for nose-up orientation
    if (typeof player.forward === 'function') player.forward(this._fwd);
    else this._fwd.set(0, 0, 1).applyQuaternion(player.group.quaternion);
    let fx = this._fwd.x, fz = this._fwd.z;
    const flen = Math.hypot(fx, fz) || 1;
    fx /= flen; fz /= flen;

    this._drawViewport(ctx, cx, cy, R, fx, fz, camera);

    const blipList = Array.isArray(allies) ? allies : [];

    for (const a of blipList) {
      if (!a?.alive || !a.group?.position) continue;
      const dx = a.group.position.x - player.position.x;
      const dz = a.group.position.z - player.position.z;
      const { px, py, edge } = this._toRadarPos(dx, dz, fx, fz, cx, cy, R);

      ctx.fillStyle = '#4fd1ff';
      ctx.shadowColor = '#4fd1ff';
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(px, py, edge ? this._blipEdgeR : this._blipR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.group.position.x - player.position.x;
      const dz = e.group.position.z - player.position.z;
      const { px, py, edge } = this._toRadarPos(dx, dz, fx, fz, cx, cy, R);
      const isTarget = e === target;

      ctx.fillStyle = '#ff5a4d';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(px, py, edge ? this._blipEdgeR : (isTarget ? this._targetR : this._blipR), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (isTarget && !edge) {
        ctx.strokeStyle = 'rgba(255, 200, 180, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, this._targetRingR, 0, Math.PI * 2); ctx.stroke();
      }
    }

    ctx.restore();

    // Player marker (always at centre)
    ctx.fillStyle = '#9bf0ff';
    ctx.shadowColor = '#9bf0ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, this._playerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  setStats({ score, hp, maxHp }) {
    this.el.score.textContent = score;

    if (hp < this._lastHp - 0.5) this.flashDamage();
    this._lastHp = hp;
    // Persistent low-hp vignette
    const dmg = 1 - hp / maxHp;
    if (dmg > 0.5) this.el.vignette.style.opacity = (dmg - 0.5) * 0.7;
    else this.el.vignette.style.opacity = 0;
  }

  setAutopilot(on) {
    if (this.el.apBtn) this.el.apBtn.classList.toggle('on', on);
    if (this.el.apState) this.el.apState.textContent = on ? 'ON' : 'OFF';
  }

  setDayCycle(phase, paused = false, matchProgress = null) {
    const ring = this.el.cycleRing;
    if (ring) {
      const fill = matchProgress ?? phase;
      ring.style.strokeDasharray = `${this._cycleRingLen}`;
      ring.style.strokeDashoffset = `${this._cycleRingLen * (1 - fill)}`;
    }
    if (this.el.cycleBtn) {
      const night = phase < 0.22 || phase > 0.36;
      this.el.cycleBtn.classList.toggle('paused', paused);
      this.el.cycleBtn.classList.toggle('is-night', night);
    }
  }

  setMatchTimer(secondsLeft) {
    if (!this.el.matchTimer) return;
    const s = Math.max(0, Math.ceil(secondsLeft));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    this.el.matchTimer.textContent = `${m}:${String(sec).padStart(2, '0')}`;
  }

  _allySpeedPct(ally) {
    const min = ally.minSpeed ?? 0;
    const max = ally.maxSpeed ?? Math.max(ally.speed ?? 0, 1);
    const span = max - min;
    if (span <= 0) return 100;
    return Math.max(0, Math.min(100, ((ally.speed ?? 0) - min) / span * 100));
  }

  _ensureAllyFrame(ally) {
    let frame = this._allyFrames.get(ally.id);
    if (frame) return frame;
    const root = document.createElement('div');
    root.className = 'ally-frame';
    root.dataset.allyId = ally.id;
    root.innerHTML = `
      <div class="ally-head">
        <span class="ally-lvl">1</span>
        <div class="ally-portrait">${this._jetIcon}</div>
        <div class="ally-bars">
          <div class="ally-hp-track"><div class="ally-hp-fill"></div></div>
          <div class="ally-spd-track"><div class="ally-spd-fill"></div></div>
        </div>
      </div>
    `;
    this.el.allyBar?.appendChild(root);
    frame = {
      root,
      lvl: root.querySelector('.ally-lvl'),
      hp: root.querySelector('.ally-hp-fill'),
      spd: root.querySelector('.ally-spd-fill'),
    };
    this._allyFrames.set(ally.id, frame);
    return frame;
  }

  // Compact circular ally portraits with HP + speed bars.
  updateAllyFrames(allies) {
    const bar = this.el.allyBar;
    if (!bar) return;
    const list = Array.isArray(allies) ? allies : [];
    const seen = new Set();

    for (const ally of list) {
      if (!ally?.id) continue;
      seen.add(ally.id);
      const frame = this._ensureAllyFrame(ally);
      frame.root.classList.toggle('is-dead', !ally.alive);
      frame.lvl.textContent = String(ally.level ?? 1);
      const hpPct = ally.maxHp > 0 ? Math.max(0, Math.min(100, (ally.hp / ally.maxHp) * 100)) : 0;
      frame.hp.style.width = `${hpPct}%`;
      frame.spd.style.width = `${this._allySpeedPct(ally)}%`;
    }

    for (const [id, frame] of this._allyFrames) {
      if (!seen.has(id)) {
        frame.root.remove();
        this._allyFrames.delete(id);
      }
    }
  }

  clearAllyFrames() {
    if (this.el.allyBar) this.el.allyBar.innerHTML = '';
    this._allyFrames.clear();
  }

  flashDamage() {
    const v = this.el.vignette;
    v.style.transition = 'opacity 0.05s';
    v.style.opacity = '0.9';
    setTimeout(() => { v.style.transition = 'opacity 0.4s'; v.style.opacity = '0'; }, 60);
  }

  logElimination({ killer, victim }) {
    const teamClass = (entity) => (entity?.team === 'enemy' ? 'elim-team-enemy' : 'elim-team-ally');

    const div = document.createElement('div');
    div.className = 'elim-msg';
    if (killer) {
      div.innerHTML = `<span class="elim-name ${teamClass(killer)}">${killer.displayName}</span> eliminated <span class="elim-name ${teamClass(victim)}">${victim.displayName}</span>`;
    } else {
      div.innerHTML = `<span class="elim-name ${teamClass(victim)}">${victim.displayName}</span> was eliminated`;
    }
    this.el.killfeed.appendChild(div);
    setTimeout(() => div.remove(), 4200);
  }

  clearKillfeed() {
    if (this.el.killfeed) this.el.killfeed.innerHTML = '';
  }

  // Project target to screen for lead marker + off-screen arrow.
  updateTarget(target, camera, w, h) {
    if (!target || !target.alive) {
      this.el.lead.classList.add('hidden');
      this.el.arrow.classList.add('hidden');
      return;
    }
    this._v.copy(target.group.position).project(camera);
    const onScreen = this._v.z < 1 && Math.abs(this._v.x) <= 1 && Math.abs(this._v.y) <= 1;
    if (onScreen && this._v.z < 1) {
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      this.el.lead.style.left = `${x}px`;
      this.el.lead.style.top = `${y}px`;
      this.el.lead.classList.remove('hidden');
      this.el.arrow.classList.add('hidden');
    } else {
      this.el.lead.classList.add('hidden');
      // Off-screen arrow pointing toward target
      let ang = Math.atan2(this._v.y, this._v.x);
      if (this._v.z > 1) ang += Math.PI; // behind
      const r = Math.min(w, h) * 0.32;
      const x = w / 2 + Math.cos(ang) * r;
      const y = h / 2 - Math.sin(ang) * r;
      this.el.arrow.style.left = `${x}px`;
      this.el.arrow.style.top = `${y}px`;
      this.el.arrow.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
      this.el.arrow.classList.remove('hidden');
    }
  }
}
