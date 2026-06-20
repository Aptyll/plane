import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Reusable scratch colour so per-frame cloud tinting doesn't allocate.
const _tint = new THREE.Color();

// Builds the atmospheric world: sky dome, sun, stylized non-reflective ocean,
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
    // A stylized, non-reflective ocean. Waves are computed procedurally in the
    // shader (no mirror reflection, no blurry render-target), giving crisp,
    // readable swell + chop, sun glitter and foam, with the surface colour fading
    // to the horizon haze so depth and motion read clearly.
    // Large enough that its far edge stays past the fog's full-haze distance, so
    // the player never sees the plane's rim — just a clean horizon.
    const geom = new THREE.PlaneGeometry(30000, 30000, 1, 1);

    const vertexShader = /* glsl */`
      varying vec3 vWorld;
      varying float vFogDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `;

    const fragmentShader = /* glsl */`
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      uniform vec3 uSky;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      varying vec3 vWorld;
      varying float vFogDepth;

      // Cheap value noise / fbm used to break up the wave grid and add variety.
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 3; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
        return v;
      }

      // One directional wave; accumulates height + analytic slope so the normal
      // always matches the surface (keeps the lighting crisp and consistent).
      void wave(vec2 p, vec2 dir, float len, float speed, float amp, float t,
                inout float h, inout vec2 grad) {
        float k = 6.2831853 / len;
        float ph = dot(p, dir) * k + t * speed;
        h += amp * sin(ph);
        grad += dir * (amp * k * cos(ph));
      }

      void main() {
        vec2 p = vWorld.xz;
        float dist = distance(cameraPosition, vWorld);
        // Fade fine detail with distance so the far sea doesn't shimmer/alias.
        float near = 1.0 - smoothstep(300.0, 2600.0, dist);
        float mid  = 1.0 - smoothstep(1200.0, 6000.0, dist);

        // Domain warp bends the wavefronts so they never form a regular grid.
        vec2 q = p * 0.004 + vec2(0.0, uTime * 0.015);
        vec2 warp = vec2(fbm(q), fbm(q + 5.2)) - 0.5;
        vec2 pw = p + warp * 70.0;

        // Large-scale "gust" field: slow patches of calmer / choppier water.
        float gust = fbm(p * 0.0016 + vec2(uTime * 0.008, 0.0));
        float chop = 0.55 + 0.9 * gust;

        // Many waves, non-orthogonal directions and irrational wavelengths, so
        // the combined pattern has no visible repeat.
        float h = 0.0;
        vec2 grad = vec2(0.0);
        wave(pw, normalize(vec2( 0.82,  0.57)), 237.0, 1.05, 2.2,             uTime, h, grad);
        wave(pw, normalize(vec2(-0.51,  0.86)), 149.0, 1.30, 1.5,             uTime, h, grad);
        wave(pw, normalize(vec2( 0.27,  0.96)),  97.0, 1.60, 1.0 * mid,       uTime, h, grad);
        wave(pw, normalize(vec2( 0.95, -0.12)),  53.0, 2.00, 0.6 * mid * chop, uTime, h, grad);
        wave(pw, normalize(vec2(-0.73,  0.45)),  31.0, 2.50, 0.32 * near * chop, uTime, h, grad);
        wave(pw, normalize(vec2( 0.41, -0.83)),  18.5, 3.00, 0.18 * near * chop, uTime, h, grad);
        wave(pw, normalize(vec2(-0.12,  0.99)),   9.7, 3.70, 0.08 * near * chop, uTime, h, grad);

        vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);

        // Gentle deep/shallow shift — kept soft so troughs never read as dark cells.
        float crest = clamp(h * 0.09 + 0.5, 0.2, 0.9);
        vec3 col = mix(uDeep, uShallow, crest);

        // Ambient sky fill with a floor so troughs stay luminous (no checkering).
        col += uSky * (0.16 + 0.10 * clamp(N.y, 0.0, 1.0));
        // Sun diffuse warmth.
        col += uSunColor * 0.10 * max(dot(N, L), 0.0);

        // Sharp sun glitter — sparkle, not a mirror.
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 260.0);
        col += uSunColor * spec * 2.0;

        // Subtle horizon sheen (fresnel toward grazing angles), no scene reflection.
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col = mix(col, uSky, fres * 0.20);

        // Foam on the steepest wave faces for readable motion + scale.
        float foam = smoothstep(0.18, 0.36, length(grad)) * (0.35 + 0.55 * near);
        col = mix(col, uFoam, clamp(foam, 0.0, 0.6));

        // Large-scale brightness variety so the surface isn't a uniform pattern.
        col *= 0.88 + 0.24 * gust;

        // Match the scene's linear horizon fog so the sea melts into the haze.
        col = mix(col, fogColor, smoothstep(fogNear, fogFar, vFogDepth));

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: this.sunPosition.clone().normalize() },
        uSunColor: { value: new THREE.Color(0xfff2e0) },
        uDeep: { value: new THREE.Color(0x0e2c43) },
        uShallow: { value: new THREE.Color(0x236488) },
        uFoam: { value: new THREE.Color(0xdfeef5) },
        uSky: { value: new THREE.Color(0x9fc4dd) },
        fogColor: { value: this.fogColor },
        fogNear: { value: 3200 },
        fogFar: { value: 13500 },
      },
      vertexShader,
      fragmentShader,
      fog: false, // fog applied manually above to match scene.fog
    });

    this.ocean = new THREE.Mesh(geom, mat);
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = 0;
    this.scene.add(this.ocean);
  }

  _buildClouds() {
    // A library of hand-painted cloud silhouettes so no two clouds look alike.
    this.cloudTextures = [];
    const variants = this.lowQuality ? 5 : 9;
    for (let i = 0; i < variants; i++) this.cloudTextures.push(this._makeCloudTexture());

    // One shared quad. Each cloud is a few of these crossed at fixed angles, so
    // it reads as a solid puff from any side and — crucially — stays anchored in
    // the world. No billboarding, so the sky no longer rotates with the camera.
    this._cloudGeo = new THREE.PlaneGeometry(1, 1);

    // Lower fair-weather deck: large and mostly white — the main sense of scale.
    this._spawnCloudLayer({
      count: this.lowQuality ? 16 : 24,
      minR: 1500, maxR: 6500, minH: 340, maxH: 760,
      minScale: 700, maxScale: 1700, flatten: 0.4,
      opacity: 0.96, grayChance: 0.3,
    });
    // Higher deck: bigger, softer and a touch greyer — distant towers for depth.
    this._spawnCloudLayer({
      count: this.lowQuality ? 8 : 13,
      minR: 2600, maxR: 7200, minH: 1150, maxH: 1850,
      minScale: 950, maxScale: 2300, flatten: 0.34,
      opacity: 0.84, grayChance: 0.55,
    });
  }

  _spawnCloudLayer(o) {
    const planes = this.lowQuality ? 2 : 3;
    for (let i = 0; i < o.count; i++) {
      const tex = this.cloudTextures[(Math.random() * this.cloudTextures.length) | 0];
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        fog: false,            // we apply our own aerial perspective per cloud
        side: THREE.DoubleSide,
      });

      // Colour variety: mostly white, some light grey, a few moody storm-greys.
      let v;
      const roll = Math.random();
      if (roll > o.grayChance) v = 0.95 + Math.random() * 0.05;            // white
      else if (roll > o.grayChance * 0.35) v = 0.78 + Math.random() * 0.12; // light grey
      else v = 0.6 + Math.random() * 0.15;                                  // storm grey
      const baseColor = new THREE.Color().setHSL(0.6, (1 - v) * 0.28, v);

      // Crossed quads at fixed local angles => volume from every direction.
      const group = new THREE.Group();
      for (let k = 0; k < planes; k++) {
        const m = new THREE.Mesh(this._cloudGeo, mat);
        m.rotation.y = (k / planes) * Math.PI;
        group.add(m);
      }
      const w = o.minScale + Math.random() * (o.maxScale - o.minScale);
      const h = w * (o.flatten + Math.random() * 0.16);
      group.scale.set(w, h, w); // x === z keeps the crossed planes shear-free

      const r = o.minR + Math.random() * (o.maxR - o.minR);
      const a = Math.random() * Math.PI * 2;
      const hY = o.minH + Math.random() * (o.maxH - o.minH);
      group.position.set(Math.cos(a) * r, hY, Math.sin(a) * r);
      group.rotation.y = Math.random() * Math.PI * 2; // fixed, world-anchored

      group.userData = { mat, baseColor, baseOpacity: o.opacity };
      this.scene.add(group);
      this.clouds.push(group);
    }
  }

  // A single, clean cumulus painted onto a canvas: a solid white body with a
  // soft silhouette (no internal noise), a cool shadow on the underside and a
  // warm sun-side highlight. Profile is randomised so silhouettes vary from
  // tall billowing towers to wide flat banks.
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

    const arch = 0.1 + Math.random() * 0.18;          // how tall the billows rise
    const halfW = size * (0.16 + Math.random() * 0.14); // narrow tower .. wide bank
    const lump = 0.6 + Math.random() * 0.8;           // edge raggedness
    const cx = size * 0.5;
    const baseY = size * 0.62;                         // flattish underside
    const lobes = 5 + (Math.random() * 5 | 0);
    for (let i = 0; i < lobes; i++) {
      const t = i / (lobes - 1);
      const a = Math.sin(t * Math.PI);                // billows highest in middle
      const x = cx + (t - 0.5) * 2 * halfW + (Math.random() - 0.5) * size * 0.05 * lump;
      const y = baseY - size * (0.04 + arch * a) - Math.random() * size * 0.05 * lump;
      const r = size * (0.06 + 0.06 * a + Math.random() * 0.03);
      disc(x, y, r);
    }
    // Thicken and round off the base.
    disc(cx - halfW * 0.5, baseY - size * 0.03, size * 0.11);
    disc(cx + halfW * 0.5, baseY - size * 0.04, size * 0.11);
    disc(cx, baseY - size * 0.02, size * 0.12);

    // Cool shadow on the underside — only inside the cloud (source-atop).
    ctx.globalCompositeOperation = 'source-atop';
    const shade = ctx.createLinearGradient(0, size * (0.3 + Math.random() * 0.08), 0, size * 0.78);
    shade.addColorStop(0, 'rgba(205,221,239,0)');
    shade.addColorStop(1, `rgba(150,172,200,${(0.42 + Math.random() * 0.22).toFixed(3)})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, size, size);

    // Warm sun-side highlight on the upper lobes.
    const hx = size * (0.36 + Math.random() * 0.18);
    const hi = ctx.createRadialGradient(hx, size * 0.28, 0, hx, size * 0.28, size * 0.5);
    hi.addColorStop(0, 'rgba(255,251,242,0.5)');
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
    // Animate the ocean and keep it + the clouds centered on the player so the
    // world feels endless without a huge geometry. Waves are world-space, so
    // recentering the mesh doesn't slide them.
    if (this.ocean) {
      this.ocean.material.uniforms.uTime.value += dt;
      this.ocean.position.x = playerPos.x;
      this.ocean.position.z = playerPos.z;
    }
    // Keep the shadow-casting sun frustum centred on the player.
    if (playerPos) {
      this.sunLight.target.position.copy(playerPos);
      this.sunLight.position.copy(playerPos).addScaledVector(this.sunPosition, 600);
    }
    // Drift clouds slowly and apply aerial perspective: distant clouds fade and
    // cool toward the horizon haze, which gives the sky readable depth layers.
    // The clouds are fixed world geometry, so this never reorients them — the
    // sky stays put as the camera banks and orbits.
    for (const c of this.clouds) {
      c.position.x += dt * 3.5;
      if (c.position.x - playerPos.x > 8000) c.position.x -= 16000;
      const dx = c.position.x - playerPos.x;
      const dz = c.position.z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const f = THREE.MathUtils.clamp((dist - 3500) / 7000, 0, 1);
      const u = c.userData;
      u.mat.opacity = u.baseOpacity * (1 - 0.6 * f);
      _tint.copy(u.baseColor).lerp(this.fogColor, 0.6 * f);
      u.mat.color.copy(_tint);
    }
  }
}
