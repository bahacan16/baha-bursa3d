import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { N8AOPass } from 'n8ao';
import type { Quality } from '../core/settings';
import { ExposureMeter, TAAPass } from './taa';

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
    tExposure: { value: null },
    uExpRef: { value: 0.0 },
    uExpStrength: { value: 0.0 },
    uExpRange: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uShadowTint, uHighlightTint;
    uniform float uSaturation;
    varying vec2 vUv;
    #ifdef AUTO_EXPOSURE
    uniform sampler2D tExposure;
    uniform float uExpRef, uExpStrength;
    uniform vec2 uExpRange;
    #endif
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      #ifdef AUTO_EXPOSURE
      // kalibre pozlamaya göre kısmi uyum: ölçülen log ortalama referanstan sapınca yarı yarıya düzelt
      float lavg = texture2D(tExposure, vec2(0.5)).r;
      c *= clamp(exp((uExpRef - lavg) * uExpStrength), uExpRange.x, uExpRange.y);
      #endif
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
 * Ultra ekran uzayı bitişi (ton eşleme + sRGB sonrası): aynı S eğrisi ve vinyet + TAA yumuşaklığını geri alan uyarlamalı
 * keskinleştirme (CAS benzeri) + kenarlarda hafif yanal kromatik sapma + luma'ya bağlı, kare başına değişen ince
 * film greni (sensör gürültüsü gibi gölge/orta tonlarda, parlaklarda az; renk gürültüsü %15).
 */
const FinishUltraShader = {
  name: 'CameraFinishUltra',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.1 },
    uContrast: { value: 0.14 },
    uTime: { value: 0 },
    uGrain: { value: 1.3 },
    uCA: { value: 1.0 },
    uSharpen: { value: 0.35 },
  },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uVignette, uContrast, uTime, uGrain, uCA, uSharpen;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }
    vec3 curve(vec3 c) {
      c = max(c - 0.008, 0.0) / 0.992;
      return mix(c, c * c * (3.0 - 2.0 * c), uContrast);
    }
    void main() {
      vec2 px = 1.0 / uResolution;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
      // CAS: yerel kontrasta göre ağırlık (düz alanlarda gürültüyü büyütmez, kenarda hale yapmaz)
      vec3 mn = min(c, min(min(n, s), min(e, w)));
      vec3 mx = max(c, max(max(n, s), max(e, w)));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
      vec3 wgt = -amp * uSharpen * 0.2;
      vec3 sh = clamp((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), mn, mx);
      // yanal kromatik sapma: kırmızı dışa, mavi içe (köşede ~1.2 px @1080p)
      vec2 d = vUv - 0.5;
      vec2 ca = d * dot(d, d) * uCA * 0.006;
      float r = texture2D(tDiffuse, vUv + ca).r;
      float b = texture2D(tDiffuse, vUv - ca).b;
      sh.r += r - c.r;
      sh.b += b - c.b;
      vec3 col = curve(max(sh, 0.0));
      vec2 p = d * vec2(uResolution.x / uResolution.y, 1.0) / 1.02;
      col *= 1.0 - uVignette * smoothstep(0.1, 1.0, dot(p, p));
      // film greni: yaklaşık Gauss (4 düzgün toplamı), kare başına yeni tohum
      vec2 fp = floor(vUv * uResolution);
      float t = fract(uTime * 0.618) * 97.0;
      float g = (hash(fp + t) + hash(fp + t + 17.3) + hash(fp + t + 41.7) + hash(fp + t + 63.1) - 2.0) * 1.73;
      vec3 gc = vec3(hash(fp + t + 5.1), hash(fp + t + 9.7), hash(fp + t + 13.3)) - 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // gürültü eğrisi (ekran uzayı): koyu–orta tonlarda en çok, parlakta sönük
      float amp2 = uGrain / 255.0 * (0.55 + 1.6 * sqrt(l) * (1.0 - l));
      col += (g + gc * 0.3) * amp2 * vec3(1.0);
      col += (hash(fp) + hash(fp + 71.0) - 1.0) / 255.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
  private smaa: SMAAPass | null = null;
  readonly grade: ShaderPass;
  readonly finish: ShaderPass;
  /** Ultra: zamansal kenar yumuşatma + otomatik pozlama */
  readonly taa: TAAPass | null = null;
  readonly exposure: ExposureMeter | null = null;
  private time = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: Quality,
    readonly ultra = false,
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
    // Ultra: tam çözünürlük, 64 örnek (TAA gürültüyü biriktirir)
    this.ao.setQualityMode(ultra ? 'High' : quality === 'high' ? 'Medium' : 'Low');
    this.composer.addPass(this.ao);
    const q = new URLSearchParams(location.search);
    if (ultra && !q.has('notaa')) {
      this.taa = new TAAPass(camera, () => this.ao.beautyRenderTarget.depthTexture, size.x, size.y);
      this.composer.addPass(this.taa);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    if (ultra) {
      // Ultra: parlak kaynakları sensör doygunluğu gibi sınırla (güneş diski ~6e4 → tüm kareye perde yaymasın)
      const hp = this.bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace(
        'vec4 texel = texture2D( tDiffuse, vUv );',
        'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\ttexel.rgb *= min( 1.0, 40.0 / max( max( texel.r, max( texel.g, texel.b ) ), 1e-4 ) );',
      );
      hp.needsUpdate = true;
    }
    if (!this.taa) {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }
    this.grade = new ShaderPass(GradeShader);
    if (ultra && !q.has('noae')) {
      this.exposure = new ExposureMeter();
      const g = this.grade.material;
      g.defines.AUTO_EXPOSURE = '';
      g.needsUpdate = true;
      const u = this.grade.uniforms;
      u.tExposure.value = this.exposure.texture;
      // Referans = kalibrasyon görüşlerinin ölçülen log ortalaması (Street View 11 görüş, Neutral ton eşleme öncesi)
      u.uExpRef.value = Number(q.get('aeref') ?? ULTRA_EXPOSURE_REF);
      u.uExpStrength.value = Number(q.get('ae') ?? 0.5);
      u.uExpRange.value.set(0.75, 1.6);
    }
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(ultra ? FinishUltraShader : FinishShader);
    this.composer.addPass(this.finish);
    if (ultra) {
      const f = this.finish.uniforms;
      if (q.has('grain')) f.uGrain.value = Number(q.get('grain'));
      if (q.has('ca')) f.uCA.value = Number(q.get('ca'));
      if (q.has('sharp')) f.uSharpen.value = Number(q.get('sharp'));
    }
    // Ayar denemesi: ?sat=1.1&con=0.3&vig=0.1
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
    if (this.ultra && n <= 0.15) {
      // Ultra gündüz: yalnız çok parlak kaynaklar (güneş diski, camlarda/araçlarda güneş parıltısı) — gökyüzü
      // eşiğin çok altında kaldığı için mavi perde oluşmaz. Lens saçılması gibi geniş ve zayıf.
      this.bloom.enabled = true;
      this.bloom.strength = 0.25;
      this.bloom.radius = 0.6;
      this.bloom.threshold = 6;
      return;
    }
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
    this.time += dt;
    if (this.ultra) this.finish.uniforms.uTime.value = this.time;
    if (this.exposure) {
      if (this.taa?.reset) this.exposure.snap();
      // ölçüm: bir önceki karenin TAA geçmişi yerine bu karenin güzel hedefi (AO öncesi, yeterli)
      this.exposure.update(this.renderer, this.target.texture, dt);
      this.grade.uniforms.tExposure.value = this.exposure.texture;
    }
    this.composer.render(dt);
  }

  /** Hata ayıklama: uyarlanmış ln(ortalama parlaklık) (otomatik pozlama referansı ölçümü için). */
  readExposure(): number | null {
    if (!this.exposure) return null;
    const buf = new Float32Array(4);
    this.renderer.readRenderTargetPixels(this.exposure.target, 0, 0, 1, 1, buf);
    return buf[0];
  }

  dispose(): void {
    this.taa?.dispose();
    this.exposure?.dispose();
    this.composer.dispose();
  }
}

/** Ultra otomatik pozlama referansı: kalibrasyon görüşlerinde ölçülen ln(ortalama parlaklık) (bkz. BLENDER_CHANGES). */
export const ULTRA_EXPOSURE_REF = -1.0;
