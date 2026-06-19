# SKYBREAKER — Aerial Combat

A single-player 3D dogfighting game built with [three.js](https://threejs.org/).
Pilot a military jet over an open sea, fight waves of enemy fighters, and rack up
a high score. Designed mobile- and controller-first, with full keyboard support.

![stylized realism: dynamic sky, reflective ocean, bloom + fog]()

## Features

- **Stylized-realism visuals** — physically-based sky & sun, reflective animated
  ocean (`Water`), drifting volumetric-style clouds, horizon fog, ACES tone
  mapping, and an UnrealBloom + SMAA post pipeline.
- **Arcade flight model** — banked turns, afterburner, wingtip contrails, dynamic
  speed-based FOV, and damage smoke.
- **Wave-based dogfighting** — enemy AI that pursues, strafes, and breaks off;
  guns + homing missiles with target lock.
- **Multiple cameras** — Chase (default), Wide, Cockpit, and an orbiting
  Cinematic view. Cycle them live with the **CAM** button / `C` / gamepad **Y**.
- **Mobile + controller first** — on-screen virtual joystick & buttons, full
  Gamepad API support, keyboard fallback. Adaptive quality on touch devices.
- **Autopilot** — hand the jet to a competent AI pilot that flies lead-pursuit
  gunnery, missile locks, energy-managed banking turns, sea/altitude safety, and
  barrel-roll flair. Toggle in-game or start straight into spectator mode with
  **WATCH AI** on the menu.

## Controls

| Action      | Touch              | Gamepad            | Keyboard            |
|-------------|--------------------|--------------------|---------------------|
| Steer       | Left joystick      | Left stick         | WASD / Arrow keys   |
| Throttle    | ▲ / ▼ buttons      | RT / LT triggers   | E / Q (Shift/Ctrl)  |
| Fire guns   | FIRE button        | A / RT             | Space               |
| Missile     | MSL button         | B                  | F                   |
| Switch cam  | CAM button         | Y                  | C                   |
| Autopilot   | AUTOPILOT button   | X                  | P                   |

Stick up = nose up, stick left/right = bank & turn.

## Running it

ES modules must be served over HTTP (opening `index.html` via `file://` won't
work). three.js loads from a CDN, so an internet connection is needed on first
run. From the project folder pick any static server:

```bash
# Python (no install)
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000> in a modern browser. On mobile, open the same
URL from your phone on the same network.

## Project structure

```
index.html              # entry, importmap, HUD + touch UI markup
src/
  main.js               # renderer, post-processing, loop, screens
  game.js               # orchestration, waves, scoring, targeting
  styles.css            # HUD / menus / touch controls
  world/environment.js  # sky, sun, ocean, clouds, fog, lighting
  entities/
    jetModel.js         # procedural fighter jet model
    plane.js            # player flight physics + weapons
    enemy.js            # enemy AI
    projectiles.js      # bullets + homing missiles
  systems/
    input.js            # touch joystick + gamepad + keyboard
    pilot.js            # autonomous AI pilot (autopilot)
    cameraRig.js        # multi-mode follow camera
    effects.js          # trails, afterburner, explosions
    hud.js              # DOM HUD, reticle, target markers
```
