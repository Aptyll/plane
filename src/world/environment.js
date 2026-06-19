import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';

// Builds the atmospheric world: sky dome, sun, reflective ocean, volumetric-ish
// clouds and lighting. Tuned for a warm, cinematic "golden afternoon" look.
export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.sunPosition = new THREE.Vector3();
    this.clouds = [];
    this.lowQuality = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    this._buildLights();
    this._buildSky();
    this._buildOcean();
    this._buildClouds();
    this._buildFogColor();
  }

  _buildLights() {
    // Warm key (sun) + cool sky fill for nice form definition.
    this.sunLight = new THREE.DirectionalLight(0xfff0d8, 1.9);
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

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x33506b, 0.7);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x405d7a, 0.4);
    this.scene.add(this.ambient);
  }

  _buildSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.scene.add(this.sky);

    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.8;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.85;

    // Low-ish sun => warm light, long shadows, dramatic sky.
    const elevation = 14; // degrees
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
    const geom = new THREE.PlaneGeometry(20000, 20000, 1, 1);
    const normals = new THREE.TextureLoader().load(
      'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/textures/waternormals.jpg',
      (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    );

    this.water = new Water(geom, {
      textureWidth: this.lowQuality ? 256 : 512,
      textureHeight: this.lowQuality ? 256 : 512,
      waterNormals: normals,
      sunDirection: this.sunPosition.clone().normalize(),
      sunColor: 0xfff0d8,
      waterColor: 0x12354f,
      distortionScale: 3.4,
      fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0;
    this.scene.add(this.water);
  }

  _buildClouds() {
    // Soft sprite-based cloud banks for parallax + depth.
    const tex = this._makeCloudTexture();
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      color: 0xfff4e6,
    });

    const count = 70;
    for (let i = 0; i < count; i++) {
      const spr = new THREE.Sprite(mat.clone());
      const r = 1400 + Math.random() * 4200;
      const a = Math.random() * Math.PI * 2;
      const h = 220 + Math.random() * 900;
      spr.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
      const sc = 400 + Math.random() * 900;
      spr.scale.set(sc, sc * (0.45 + Math.random() * 0.3), 1);
      spr.material.opacity = 0.55 + Math.random() * 0.4;
      // tint distant clouds slightly cooler
      const cool = Math.min(1, r / 5000);
      spr.material.color.setRGB(1 - cool * 0.1, 0.96 - cool * 0.08, 0.9);
      this.scene.add(spr);
      this.clouds.push(spr);
    }
  }

  _makeCloudTexture() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    // Build a puffy cloud out of overlapping radial blobs.
    const blob = (x, y, r, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    for (let i = 0; i < 22; i++) {
      const x = size * (0.3 + Math.random() * 0.4);
      const y = size * (0.4 + Math.random() * 0.25);
      const r = size * (0.12 + Math.random() * 0.16);
      blob(x, y, r, 0.5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  _buildFogColor() {
    // Horizon-matched fog so the ocean melts into the sky.
    this.fogColor = new THREE.Color(0xa9c6dd);
    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.00018);
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
    // Drift clouds slowly.
    for (const c of this.clouds) {
      c.position.x += dt * 4;
      if (c.position.x - playerPos.x > 5200) c.position.x -= 10400;
    }
  }
}
