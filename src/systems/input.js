// Unified input: virtual touch joystick + buttons, gamepad, keyboard fallback.
// Exposes a normalized control state consumed by the plane + camera each frame.

export class Input {
  constructor() {
    this.state = {
      steerX: 0,      // -1 (left) .. 1 (right)  -> roll/yaw
      steerY: 0,      // -1 (up)   .. 1 (down)   -> pitch (screen-natural)
      throttle: 0,    // delta request this frame (-1..1)
      fire: false,
      missile: false, // edge-triggered (true for one frame)
      cameraNext: false, // edge-triggered
      autopilotToggle: false, // edge-triggered
    };

    this._missileHeld = false;
    this._camHeld = false;
    this._pHeld = false;
    this._autoReq = false;
    this._keys = new Set();
    this._stick = { active: false, id: null, x: 0, y: 0 };
    this._btn = { fire: false, msl: false, thrUp: false, thrDown: false, cam: false };

    this._bindKeyboard();
    this._bindTouch();
  }

  // ---------- Keyboard ----------
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this._keys.add(e.code);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
  }

  // ---------- Touch / pointer joystick ----------
  _bindTouch() {
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    if (!zone) return;
    this._base = base; this._knob = knob;
    this._baseRadius = 56;

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const resetKnob = () => { knob.style.transform = 'translate(0,0)'; base.classList.remove('active'); };

    const start = (clientX, clientY, id) => {
      this._stick.active = true; this._stick.id = id;
      const r = base.getBoundingClientRect();
      this._stick.cx = r.left + r.width / 2;
      this._stick.cy = r.top + r.height / 2;
      // Recenter base near touch point for ergonomics on large zone
      base.classList.add('active');
      move(clientX, clientY);
    };
    const move = (clientX, clientY) => {
      let dx = clientX - this._stick.cx;
      let dy = clientY - this._stick.cy;
      const dist = Math.hypot(dx, dy);
      const max = this._baseRadius;
      if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
      setKnob(dx, dy);
      this._stick.x = dx / max;
      this._stick.y = dy / max;
    };
    const end = () => {
      this._stick.active = false; this._stick.id = null;
      this._stick.x = 0; this._stick.y = 0;
      resetKnob();
    };

    // Pointer events cover both touch and mouse.
    zone.addEventListener('pointerdown', (e) => {
      if (this._stick.active) return;
      zone.setPointerCapture(e.pointerId);
      start(e.clientX, e.clientY, e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (this._stick.active && e.pointerId === this._stick.id) move(e.clientX, e.clientY);
    });
    const up = (e) => { if (e.pointerId === this._stick.id) end(); };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);

    // Action buttons (support multi-touch hold)
    const hold = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e) => { e.preventDefault(); this._btn[key] = true; el.classList.add('active'); };
      const off = (e) => { e.preventDefault(); this._btn[key] = false; el.classList.remove('active'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('pointercancel', off);
    };
    hold('btn-fire', 'fire');
    hold('btn-missile', 'msl');
    hold('btn-throttle-up', 'thrUp');
    hold('btn-throttle-down', 'thrDown');
    hold('btn-cam', 'cam');

    // Autopilot is a click toggle (not a hold).
    const ap = document.getElementById('btn-autopilot');
    if (ap) ap.addEventListener('click', (e) => { e.preventDefault(); this._autoReq = true; });
  }

  // ---------- Gamepad ----------
  _pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) { if (p) { pad = p; break; } }
    if (!pad) return null;

    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    const out = {
      steerX: dz(pad.axes[0] || 0),
      steerY: dz(pad.axes[1] || 0),
      throttle: 0,
      fire: false, msl: false, cam: false,
    };
    // Right stick Y for throttle, plus triggers
    const rt = pad.buttons[7] ? pad.buttons[7].value : 0; // RT throttle up
    const lt = pad.buttons[6] ? pad.buttons[6].value : 0; // LT throttle down
    out.throttle = rt - lt;
    out.fire = (pad.buttons[0] && pad.buttons[0].pressed) || rt > 0.5; // A or RT
    out.msl = pad.buttons[1] && pad.buttons[1].pressed;  // B
    out.cam = pad.buttons[3] && pad.buttons[3].pressed;  // Y
    out.auto = pad.buttons[2] && pad.buttons[2].pressed; // X
    return out;
  }

  // ---------- Aggregate, called once per frame ----------
  update() {
    let sx = 0, sy = 0, thr = 0, fire = false, msl = false, cam = false;

    // Keyboard
    const k = this._keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) sx -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) sx += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) sy -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) sy += 1;
    if (k.has('ShiftLeft') || k.has('KeyE')) thr += 1;
    if (k.has('ControlLeft') || k.has('KeyQ')) thr -= 1;
    if (k.has('Space')) fire = true;
    if (k.has('KeyF')) msl = true;
    if (k.has('KeyC')) cam = true;

    // Touch stick + buttons
    if (this._stick.active) { sx = this._stick.x; sy = this._stick.y; }
    if (this._btn.fire) fire = true;
    if (this._btn.msl) msl = true;
    if (this._btn.thrUp) thr += 1;
    if (this._btn.thrDown) thr -= 1;
    if (this._btn.cam) cam = true;

    // Gamepad (overrides if sticks active)
    const gp = this._pollGamepad();
    if (gp) {
      if (Math.abs(gp.steerX) > 0.01 || Math.abs(gp.steerY) > 0.01) { sx = gp.steerX; sy = gp.steerY; }
      if (gp.throttle !== 0) thr += gp.throttle;
      if (gp.fire) fire = true;
      if (gp.msl) msl = true;
      if (gp.cam) cam = true;
      if (gp.auto && !this._gpAutoHeld) this._autoReq = true;
      this._gpAutoHeld = gp.auto;
    } else {
      this._gpAutoHeld = false;
    }

    this.state.steerX = Math.max(-1, Math.min(1, sx));
    this.state.steerY = Math.max(-1, Math.min(1, sy));
    this.state.throttle = Math.max(-1, Math.min(1, thr));
    this.state.fire = fire;

    // Edge-trigger missile + camera
    this.state.missile = msl && !this._missileHeld;
    this._missileHeld = msl;
    this.state.cameraNext = cam && !this._camHeld;
    this._camHeld = cam;

    // Autopilot toggle: keyboard P (edge) or the on-screen button (click).
    const pDown = k.has('KeyP');
    const pEdge = pDown && !this._pHeld;
    this._pHeld = pDown;
    this.state.autopilotToggle = this._autoReq || pEdge;
    this._autoReq = false;
  }
}
