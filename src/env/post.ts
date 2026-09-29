import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { N8AOPass } from 'n8ao';
import type { Quality } from '../core/settings';

const VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * Kamera renk ayarı (ton eşlemeden önce, doğrusal HDR): gölgeler hafif soğuk, ışıklar hafif sıcak (tek tutarlı
 * gün ışığı dengesi), doygunluk. Ocean Drive'daki yaklaşımdan uyarlandı; değerler Street View karelerine göre.
 */
const GradeShader = {
  name: 'CameraGrade',
  uniforms: {
    tDiffuse: { value: null },
    uShadowTint: { value: new THREE.Vector3(1.025, 1.0, 0.95) },
    uHighlightTint: { value: new THREE.Vector3(1.02, 1.0, 0.98) },
    uSaturation: { value: 1.0 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uShadowTint, uHighlightTint;
    uniform float uSaturation;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(uShadowTint, uHighlightTint, smoothstep(0.02, 0.25, l0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, uSaturation), 0.0);
      // en derin gölgeleri çok hafif soğuk tona kaldır (film eteği)
      c += vec3(0.003, 0.004, 0.007) * (1.0 - smoothstep(0.0, 0.06, l));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Ekran uzayı (ton eşleme + sRGB sonrası): yumuşak S eğrisi, hafif köşe kararması, bantlaşmaya karşı titreşim. */
const FinishShader = {
  name: 'CameraFinish',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.1 },
    uContrast: { value: 0.14 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uVignette, uContrast;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = max(c - 0.008, 0.0) / 0.992;
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      vec2 p = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) / 1.02;
      c *= 1.0 - uVignette * smoothstep(0.1, 1.0, dot(p, p));
      vec2 px = floor(vUv * uResolution);
      c += (hash(px) + hash(px + 71.0) - 1.0) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

/**
 * Son işleme: sahne HDR hedefe çizilir → N8AO (ortam gölgelemesi) → Bloom (gece ışıkları) → SMAA → ton eşleme.
 * KARAR: Düşük kalitede kapalı (mobil); Orta'da AO yarım çözünürlük.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly ao: N8AOPass;
  readonly bloom: UnrealBloomPass;
  private smaa: SMAAPass;
  readonly grade: ShaderPass;
  readonly finish: ShaderPass;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: Quality,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.ao = new N8AOPass(scene, camera, size.x, size.y);
    const c = this.ao.configuration;
    c.autoRenderBeauty = false; // sahneyi (arka plan dahil) biz çiziyoruz
    c.gammaCorrection = false; // OutputPass yapıyor
    c.aoRadius = 2.2;
    c.distanceFalloff = 1.2;
    c.intensity = 1.7;
    c.halfRes = quality !== 'high';
    this.ao.setQualityMode(quality === 'high' ? 'Medium' : 'Low');
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    // Ayar denemesi: ?sat=1.1&con=0.3&vig=0.1
    const q = new URLSearchParams(location.search);
    if (q.has('sat')) this.grade.uniforms.uSaturation.value = Number(q.get('sat'));
    if (q.has('con')) this.finish.uniforms.uContrast.value = Number(q.get('con'));
    if (q.has('vig')) this.finish.uniforms.uVignette.value = Number(q.get('vig'));
    if (q.has('wb')) {
      const [r, g, b] = (q.get('wb') ?? '').split(',').map(Number);
      this.grade.uniforms.uHighlightTint.value.set(r, g, b);
    }
    if (q.has('wbs')) {
      const [r, g, b] = (q.get('wbs') ?? '').split(',').map(Number);
      this.grade.uniforms.uShadowTint.value.set(r, g, b);
    }
    if (q.has('ao')) c.intensity = Number(q.get('ao'));
    if (q.has('aor')) c.aoRadius = Number(q.get('aor'));
  }

  /** Güzel (beauty) hedefi: Game bu hedefe arka plan + sahneyi çizer. */
  get target(): THREE.WebGLRenderTarget {
    return this.ao.beautyRenderTarget as THREE.WebGLRenderTarget;
  }

  setNight(n: number): void {
    // KARAR: gündüz bloom kapalı — HDR gökyüzü eşiği aşıp ağaç/bina silüetlerine mavi bir perde yayıyordu.
    this.bloom.enabled = n > 0.15;
    this.bloom.strength = 0.12 + 0.55 * n;
    this.bloom.threshold = n > 0.5 ? 0.6 : 0.9;
  }

  setSize(w: number, h: number): void {
    const dpr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.ao.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
    this.finish.uniforms.uResolution.value.set(Math.floor(w * dpr), Math.floor(h * dpr));
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
