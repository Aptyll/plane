import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Input } from './systems/input.js';
import { Game } from './game.js';

// Patch version shown on the main menu. Bump by 0.1 on every push to main.
const PATCH_VERSION = '1.3';

const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 20000);

// ---------- Post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Kept subtle so bright sky/sea can't bleed over the aircraft and hurt clarity.
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.22,  // strength
  0.5,   // radius
  0.95   // threshold — only very bright sources (afterburner, tracers, sun) bloom
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// SMAA only on desktop — on touch devices bloom + lower DPR already soften
// edges, and skipping the pass keeps the frame budget for the GPU.
if (!isTouch) composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight));

// ---------- Input + Game ----------
const input = new Input();
const game = new Game(scene, camera, renderer, input);

// ---------- Resize ----------
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
}
window.addEventListener('resize', onResize);

// ---------- Screens ----------
const loader = document.getElementById('loader');
const barFill = document.getElementById('bar-fill');
const loaderStatus = document.getElementById('loader-status');
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const touchUi = document.getElementById('touch-ui');
const gameover = document.getElementById('gameover');
const replayBanner = document.getElementById('replay-banner');

document.getElementById('patch-version').textContent = `PATCH ${PATCH_VERSION}`;

function showMenu() {
  menu.classList.remove('hidden');
  hud.classList.add('hidden');
  touchUi.classList.add('hidden');
  gameover.classList.add('hidden');
}

function startGame(autoplay = false) {
  menu.classList.add('hidden');
  gameover.classList.add('hidden');
  hud.classList.remove('hidden');
  if (isTouch) touchUi.classList.remove('hidden');
  game.start();
  game.setAutopilot(autoplay);
}

// While the death replay plays, clear the combat HUD and show the replay banner.
game.onReplayStart = () => {
  hud.classList.add('hidden');
  touchUi.classList.add('hidden');
  replayBanner.classList.remove('hidden');
};

game.onGameOver = (score, wave) => {
  document.getElementById('final-score').textContent = score;
  document.getElementById('final-wave').textContent = wave;
  hud.classList.add('hidden');
  touchUi.classList.add('hidden');
  replayBanner.classList.add('hidden');
  gameover.classList.remove('hidden');
};

// Let the player skip the replay with any tap / key press.
const skipReplay = () => { if (game.replaying) game.skipReplay(); };
window.addEventListener('keydown', skipReplay);
canvas.addEventListener('pointerdown', skipReplay);

document.getElementById('start-btn').addEventListener('click', () => startGame(false));
document.getElementById('watch-btn').addEventListener('click', () => startGame(true));
document.getElementById('restart-btn').addEventListener('click', () => startGame(game.autopilot));

// ---------- Loading sequence ----------
const steps = [
  'Spooling engines…', 'Generating ocean…', 'Painting the sky…',
  'Arming weapons…', 'Clear for takeoff',
];
let step = 0;
const loadTimer = setInterval(() => {
  step++;
  barFill.style.width = `${(step / steps.length) * 100}%`;
  loaderStatus.textContent = steps[Math.min(step, steps.length - 1)];
  if (step >= steps.length) {
    clearInterval(loadTimer);
    setTimeout(() => { loader.classList.add('hidden'); showMenu(); }, 400);
  }
}, 420);

// ---------- Main loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  let dt = clock.getDelta();
  dt = Math.min(dt, 0.05); // clamp to avoid tunneling on hitches
  game.update(dt, window.innerWidth, window.innerHeight);
  composer.render();
}
animate();

// Prevent context menu / scroll on long-press for mobile.
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
