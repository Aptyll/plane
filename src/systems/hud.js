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
