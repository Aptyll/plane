import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';

// Reusable scratch colour so per-frame cloud tinting doesn't allocate.
const _tint = new THREE.Color();

// Builds the atmospheric world: sky dome, sun, reflective ocean, stylized
// hand-painted clouds and lighting. Tuned for a clean, readable sky with a
// crisp horizon and layered aerial depth.
export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.sunPosition = new THREE.Vector3();
    this.clouds = [];
    this.lowQuality = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    this._buildFogColor();
    this._buildLights();
    this._buildSky();
    this._buildOcean();
    this._buildClouds();
  }

  _buildLights() {
    // Warm key (sun) + cool sky fill for nice form definition.
    this.sunLight = new THREE.DirectionalLight(0xfff2e0, 1.85);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(this.lowQuality ? 1024 : 2048, this.lowQuality ? 1024 : 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 1200;
    const s = 350;
    this.sunLight.shadow.camera.left = -s;
    this.sunLight.shadow.camera.right = s;
    this.sunLight.shadow.camera.top = s;
    this.sunLight.shadow.camera.bottom = -s;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x36546e, 0.75);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x456480, 0.38);
    this.scene.add(this.ambient);
  }

  _buildSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.scene.add(this.sky);

    const u = this.sky.material.uniforms;
    // Lower turbidity + a touch more Rayleigh = a cleaner, deeper blue with a
    // bright, legible band of haze along the horizon instead of an orange murk.
    u.turbidity.value = 4;
    u.rayleigh.value = 2.2;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;

    // A higher mid-morning sun reads far less chaotically than a low, glaring
    // one while still giving warm light and readable shadows.
    const elevation = 24; // degrees
    const azimuth = 135;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunPosition.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunPosition);

    this.sunLight.position.copy(this.sunPosition).multiplyScalar(600);

    // Environment map from sky for PBR reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(this.sky).texture;
  }

  _buildOcean() {
    // Large enough that its far edge stays past the fog's full-haze distance,
    // so the player never sees the plane's rim — just a clean horizon.
    const geom = new THREE.PlaneGeometry(30000, 30000, 1, 1);
    const normals = new THREE.TextureLoader().load(
      'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/textures/waternormals.jpg',
      (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    );

    this.water = new Water(geom, {
      textureWidth: this.lowQuality ? 256 : 512,
      textureHeight: this.lowQuality ? 256 : 512,
      waterNormals: normals,
      sunDirection: this.sunPosition.clone().normalize(),
      sunColor: 0xfff2e0,
      waterColor: 0x123a57,
      distortionScale: 3.2,
      fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0;
    this.scene.add(this.water);
  }

  _buildClouds() {
    // A handful of hand-painted cloud textures so the sky isn't repetitive,
    // then two readable decks of cumulus for depth without clutter.
    this.cloudTextures = [];
    for (let i = 0; i < 4; i++) this.cloudTextures.push(this._makeCloudTexture());

    this._cloudWhite = new THREE.Color(0xffffff);

    // Lower fair-weather deck: large, opaque, the main sense of altitude.
    this._spawnCloudLayer({
      count: this.lowQuality ? 14 : 20,
      minR: 1500, maxR: 6500,
      minH: 360, maxH: 720,
      minScale: 750, maxScale: 1500,
      flatten: 0.42, opacity: 0.96,
    });
    // Sparse higher deck: bigger and softer, reads as distant towers.
    this._spawnCloudLayer({
      count: this.lowQuality ? 7 : 11,
      minR: 2800, maxR: 7000,
      minH: 1150, maxH: 1750,
      minScale: 1000, maxScale: 2000,
      flatten: 0.36, opacity: 0.82,
    });
  }

  _spawnCloudLayer(o) {
    for (let i = 0; i < o.count; i++) {
      const tex = this.cloudTextures[(Math.random() * this.cloudTextures.length) | 0];
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        color: 0xffffff,
        fog: false, // we apply our own aerial perspective per cloud
      }));
      const r = o.minR + Math.random() * (o.maxR - o.minR);
      const a = Math.random() * Math.PI * 2;
      const h = o.minH + Math.random() * (o.maxH - o.minH);
      spr.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
      const sc = o.minScale + Math.random() * (o.maxScale - o.minScale);
      spr.scale.set(sc, sc * (o.flatten + Math.random() * 0.14), 1);
      spr.userData.baseOpacity = o.opacity;
      this.scene.add(spr);
      this.clouds.push(spr);
    }
  }

  // A single, clean cumulus cloud painted onto a canvas: a solid white body
  // with a soft silhouette (no internal noise), a cool shadow on the underside
  // and a warm sun-side highlight — i.e. hand-painted volume, not blobby mush.
  _makeCloudTexture() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');

    // Wide opaque core, feathered rim. Overlapping these builds a solid white
    // body (white-over-white stays white => no mottling) with soft edges only.
    const disc = (x, y, r) => {
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.72, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };

    const cx = size * 0.5;
    const baseY = size * 0.64;              // flattish underside
    const lobes = 6 + (Math.random() * 3 | 0);
    for (let i = 0; i < lobes; i++) {
      const t = i / (lobes - 1);
      const arch = Math.sin(t * Math.PI);   // billows highest in the middle
      const x = size * (0.18 + 0.64 * t) + (Math.random() - 0.5) * size * 0.05;
      const y = baseY - size * (0.05 + 0.26 * arch) - Math.random() * size * 0.04;
      const r = size * (0.085 + 0.085 * arch + Math.random() * 0.03);
      disc(x, y, r);
    }
    // Thicken and round off the base.
    disc(cx - size * 0.2, baseY - size * 0.03, size * 0.12);
    disc(cx + size * 0.18, baseY - size * 0.04, size * 0.12);

    // Cool shadow on the underside — only inside the cloud (source-atop).
    ctx.globalCompositeOperation = 'source-atop';
    const shade = ctx.createLinearGradient(0, size * 0.33, 0, size * 0.74);
    shade.addColorStop(0, 'rgba(205,221,239,0)');
    shade.addColorStop(1, 'rgba(150,172,200,0.5)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, size, size);

    // Warm sun-side highlight on the upper lobes.
    const hi = ctx.createRadialGradient(size * 0.42, size * 0.3, 0, size * 0.42, size * 0.3, size * 0.5);
    hi.addColorStop(0, 'rgba(255,251,242,0.55)');
    hi.addColorStop(1, 'rgba(255,251,242,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.lowQuality ? 2 : 8;
    tex.needsUpdate = true;
    return tex;
  }

  _buildFogColor() {
    // Linear fog: the sea stays crisp and dark up close (strong depth cues from
    // the animated water + sun glitter), then fades to a luminous haze far out,
    // leaving a clean horizon where the darker sea meets the bright sky.
    this.fogColor = new THREE.Color(0xcad9e6);
    this.scene.fog = new THREE.Fog(this.fogColor, 3200, 13500);
    this.scene.background = this.fogColor.clone();
  }

  update(dt, playerPos) {
    // Animate water and keep ocean + clouds centered on the player so the
    // world feels endless without a huge geometry.
    if (this.water) {
      this.water.material.uniforms.time.value += dt;
      this.water.position.x = playerPos.x;
      this.water.position.z = playerPos.z;
    }
    // Keep the shadow-casting sun frustum centred on the player.
    if (playerPos) {
      this.sunLight.target.position.copy(playerPos);
      this.sunLight.position.copy(playerPos).addScaledVector(this.sunPosition, 600);
    }
    // Drift clouds slowly and apply aerial perspective: distant clouds fade and
    // cool toward the horizon haze, which gives the sky readable depth layers.
    for (const c of this.clouds) {
      c.position.x += dt * 3.5;
      if (c.position.x - playerPos.x > 8000) c.position.x -= 16000;
      const dx = c.position.x - playerPos.x;
      const dz = c.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const f = THREE.MathUtils.clamp((dist - 3500) / 7000, 0, 1);
      c.material.opacity = c.userData.baseOpacity * (1 - 0.6 * f);
      _tint.copy(this._cloudWhite).lerp(this.fogColor, 0.6 * f);
      c.material.color.copy(_tint);
    }
  }
}
