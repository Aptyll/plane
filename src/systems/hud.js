import * as THREE from 'three';

// Manages all DOM HUD elements: gauges, score, reticle lead indicator,
// off-screen target arrow, kill feed, and damage feedback.
export class HUD {
  constructor() {
    this.el = {
      score: document.getElementById('hud-score'),
      wave: document.getElementById('hud-wave'),
      enemies: document.getElementById('hud-enemies'),
      hp: document.getElementById('hp-fill'),
      thr: document.getElementById('thr-fill'),
      speed: document.getElementById('hud-speed'),
      alt: document.getElementById('hud-alt'),
      lead: document.getElementById('lead-marker'),
      arrow: document.getElementById('target-arrow'),
      vignette: document.getElementById('damage-vignette'),
      hitflash: document.getElementById('hitflash'),
      killfeed: document.getElementById('killfeed'),
      reticle: document.getElementById('reticle'),
    };
    this._lastHp = 100;
    this._v = new THREE.Vector3();

    // Radar
    this.radar = document.getElementById('radar');
    this.radarCtx = this.radar ? this.radar.getContext('2d') : null;
    this.radarRange = 1000; // world units mapped to radar edge
    this._fwd = new THREE.Vector3();
  }

  // Top-down radar, nose-up: forward = up, enemies as blips, target highlighted.
  updateRadar(player, enemies, target, time) {
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

    // Rotating sweep
    const sweep = (time % 3) / 3 * Math.PI * 2;
    const grad = ctx.createConicGradient ? ctx.createConicGradient(sweep, cx, cy) : null;
    if (grad) {
      grad.addColorStop(0.0, 'rgba(79,209,255,0.35)');
      grad.addColorStop(0.08, 'rgba(79,209,255,0.0)');
      grad.addColorStop(1.0, 'rgba(79,209,255,0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(110,225,255,0.6)';
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep - Math.PI / 2) * R, cy + Math.sin(sweep - Math.PI / 2) * R);
    ctx.stroke();

    // Player heading in XZ for nose-up orientation
    player.forward(this._fwd);
    let fx = this._fwd.x, fz = this._fwd.z;
    const flen = Math.hypot(fx, fz) || 1;
    fx /= flen; fz /= flen;

    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.group.position.x - player.position.x;
      const dz = e.group.position.z - player.position.z;
      const relF = dx * fx + dz * fz;      // along forward
      const relR = dx * fz - dz * fx;      // along right
      let bx = (relR / this.radarRange) * R;
      let by = -(relF / this.radarRange) * R;
      const d = Math.hypot(bx, by);
      let edge = false;
      if (d > R) { const k = R / d; bx *= k; by *= k; edge = true; }
      const px = cx + bx, py = cy + by;
      const isTarget = e === target;

      ctx.fillStyle = isTarget ? '#ffd24a' : '#ff5a4d';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(px, py, edge ? 2 : (isTarget ? 4 : 3), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (isTarget && !edge) {
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
      }
    }

    ctx.restore();

    // Player marker (always nose-up at centre)
    ctx.fillStyle = '#9bf0ff';
    ctx.shadowColor = '#9bf0ff'; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  setStats({ score, wave, enemies, hp, maxHp, throttle, speed, minSpeed, maxSpeed, alt }) {
    this.el.score.textContent = score;
    this.el.wave.textContent = wave;
    this.el.enemies.textContent = enemies;
    this.el.hp.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
    this.el.thr.style.width = `${throttle * 100}%`;
    // Map speed to a "knots" readout for flavor.
    const kts = Math.round(((speed - minSpeed) / (maxSpeed - minSpeed)) * 600 + 120);
    this.el.speed.textContent = kts;
    this.el.alt.textContent = Math.round(alt);

    if (hp < this._lastHp - 0.5) this.flashDamage();
    this._lastHp = hp;
    // Persistent low-hp vignette
    const dmg = 1 - hp / maxHp;
    if (dmg > 0.5) this.el.vignette.style.opacity = (dmg - 0.5) * 0.7;
    else this.el.vignette.style.opacity = 0;
  }

  flashDamage() {
    const v = this.el.vignette;
    v.style.transition = 'opacity 0.05s';
    v.style.opacity = '0.9';
    setTimeout(() => { v.style.transition = 'opacity 0.4s'; v.style.opacity = '0'; }, 60);
  }

  kill(text) {
    const div = document.createElement('div');
    div.className = 'kill-msg';
    div.textContent = text;
    this.el.killfeed.appendChild(div);
    setTimeout(() => div.remove(), 2700);
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
