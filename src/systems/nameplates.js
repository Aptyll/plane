import * as THREE from 'three';

// League-style floating name + HP bars projected above each aircraft.
export class NameplateManager {
  constructor() {
    this.root = document.getElementById('nameplates');
    this._pool = new Map();
    this._anchor = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._maxDist = 1500;
  }

  clear() {
    for (const entry of this._pool.values()) entry.el.remove();
    this._pool.clear();
  }

  _acquire(entity, team) {
    let entry = this._pool.get(entity);
    if (!entry) {
      const el = document.createElement('div');
      el.className = `nameplate team-${team}`;
      el.innerHTML = [
        '<span class="np-name"></span>',
        '<div class="np-strip">',
        '<span class="np-lvl">1</span>',
        '<div class="np-bars">',
        '<div class="np-bar np-hp"><div class="np-fill np-hp-fill"></div></div>',
        '<div class="np-bar np-spd"><div class="np-fill np-spd-fill"></div></div>',
        '</div>',
        '</div>',
      ].join('');
      this.root.appendChild(el);
      entry = {
        el,
        lvl: el.querySelector('.np-lvl'),
        name: el.querySelector('.np-name'),
        hpFill: el.querySelector('.np-hp-fill'),
        spdFill: el.querySelector('.np-spd-fill'),
        team,
      };
      this._pool.set(entity, entry);
      entry.name.textContent = entity.displayName || 'Unknown';
    }
    if (entry.team !== team) {
      entry.team = team;
      entry.el.className = `nameplate team-${team}`;
    }
    return entry;
  }

  _hide(entry) {
    entry.el.classList.remove('visible', 'targeted');
  }

  _speedPct(entity) {
    const min = entity.minSpeed ?? 0;
    const max = entity.maxSpeed ?? Math.max(entity.speed, 1);
    const span = max - min;
    if (span <= 0) return 1;
    return THREE.MathUtils.clamp((entity.speed - min) / span, 0, 1);
  }

  _project(entity, camera, w, h, entry, { targeted, dist, isPlayer = false }) {
    this._up.set(0, 1, 0).applyQuaternion(entity.group.quaternion);
    const lift = isPlayer ? 3.5 : 8.5;
    this._anchor.copy(entity.group.position).addScaledVector(this._up, lift);
    this._anchor.project(camera);

    if (this._anchor.z > 1) {
      this._hide(entry);
      return;
    }

    const x = (this._anchor.x * 0.5 + 0.5) * w;
    const y = (-this._anchor.y * 0.5 + 0.5) * h;
    const onScreen = this._anchor.z < 1
      && x >= -40 && x <= w + 40
      && y >= -40 && y <= h + 40;
    if (!onScreen) {
      this._hide(entry);
      return;
    }

    const fade = THREE.MathUtils.clamp((dist - 120) / (this._maxDist - 120), 0, 1);
    const alpha = 1 - fade * 0.55;
    const scale = 1 - fade * 0.18;
    const hpPct = Math.max(0, Math.min(100, (entity.hp / entity.maxHp) * 100));
    const spdPct = this._speedPct(entity) * 100;

    entry.hpFill.style.width = `${hpPct}%`;
    entry.spdFill.style.width = `${spdPct}%`;
    entry.lvl.textContent = String(entity.level ?? 1);
    entry.el.classList.toggle('low-hp', entity.team === 'ally' && hpPct <= 30);
    entry.el.style.left = `${x}px`;
    entry.el.style.top = `${y}px`;
    entry.el.style.setProperty('--np-alpha', alpha.toFixed(3));
    entry.el.style.setProperty('--np-scale', scale.toFixed(3));
    entry.el.classList.toggle('targeted', targeted);
    entry.el.classList.add('visible');
  }

  update({ player, allies = [], enemies, camera, w, h, currentTarget, showPlayer = true }) {
    if (!this.root || !camera) return;

    const active = new Set();
    const camPos = camera.position;

    if (showPlayer && player?.alive) {
      active.add(player);
      const entry = this._acquire(player, 'ally');
      const dist = camPos.distanceTo(player.group.position);
      this._project(player, camera, w, h, entry, { targeted: false, dist, isPlayer: true });
    }

    for (const ally of allies) {
      if (!ally?.alive || ally === player) continue;
      active.add(ally);
      const entry = this._acquire(ally, 'ally');
      const dist = camPos.distanceTo(ally.group.position);
      this._project(ally, camera, w, h, entry, { targeted: false, dist });
    }

    for (const enemy of enemies) {
      if (!enemy?.alive) continue;
      active.add(enemy);
      const entry = this._acquire(enemy, 'enemy');
      const dist = camPos.distanceTo(enemy.group.position);
      this._project(enemy, camera, w, h, entry, {
        targeted: enemy === currentTarget,
        dist,
      });
    }

    for (const [entity, entry] of [...this._pool]) {
      if (!active.has(entity)) {
        entry.el.remove();
        this._pool.delete(entity);
      }
    }
  }
}
