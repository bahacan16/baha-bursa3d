import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Halton (2,3) — 8 örnekli alt piksel titretme dizisi */
function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}
const JITTER = Array.from({ length: 8 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

const ResolveShader = /* glsl */ `
  uniform sampler2D tCurrent;
  uniform sampler2D tHistory;
  uniform sampler2D tDepth;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform mat4 uPrevVP;
  uniform vec2 uTexel;
  uniform float uReset;
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // NaN/Inf tek bir karede bile geçmişe girerse kalıcı olur (karışım NaN'ı korur) → her girişte ayıkla
  bool bad(vec3 c) { return any(isnan(c)) || any(isinf(c)) || any(greaterThan(abs(c), vec3(1e6))); }
  vec3 safe(vec3 c) { return bad(c) ? vec3(0.0) : clamp(c, vec3(0.0), vec3(60000.0)); }
  // parlak piksellerin (güneş parıltısı) titreşimini azaltmak için ağırlıklı alan
  vec3 tmap(vec3 c) { return c / (1.0 + luma(c)); }
  vec3 itmap(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }
  vec3 toY(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
  vec3 fromY(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
  // 5 örnekli Catmull-Rom (geçmişi bulanıklaştırmadan örnekle)
  vec3 sampleHistory(vec2 uv) {
    vec2 size = 1.0 / uTexel;
    vec2 sp = uv * size;
    vec2 tc1 = floor(sp - 0.5) + 0.5;
    vec2 f = sp - tc1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 tc0 = (tc1 - 1.0) * uTexel;
    vec2 tc3 = (tc1 + 2.0) * uTexel;
    vec2 tc12 = (tc1 + w2 / w12) * uTexel;
    vec3 r = texture2D(tHistory, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y)
      + texture2D(tHistory, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
      + texture2D(tHistory, vec2(tc12.x, tc12.y)).rgb * (w12.x * w12.y)
      + texture2D(tHistory, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y)
      + texture2D(tHistory, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
    float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return r / ws;
  }
  void main() {
    vec3 cur = safe(texture2D(tCurrent, vUv).rgb);
    if (uReset > 0.5) { gl_FragColor = vec4(cur, 1.0); return; }
    // 3x3 komşuluk: renk momentleri + en yakın derinlik (kenarlarda ön plan hareketi)
    vec3 m1 = vec3(0.0);
    vec3 m2 = vec3(0.0);
    vec3 mn = vec3(1e9);
    vec3 mx = vec3(-1e9);
    float dmin = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y)) * uTexel;
        vec3 c = toY(tmap(safe(texture2D(tCurrent, vUv + o).rgb)));
        m1 += c;
        m2 += c * c;
        mn = min(mn, c);
        mx = max(mx, c);
        dmin = min(dmin, texture2D(tDepth, vUv + o).r);
      }
    }
    m1 /= 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
    vec3 bmin = max(mn, m1 - 1.25 * sigma);
    vec3 bmax = min(mx, m1 + 1.25 * sigma);
    // yeniden izdüşüm (dünya durağan varsayımı; gökyüzü = yalnız yön)
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 pc;
    if (dmin >= 0.999999) {
      vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
      vec3 dir = mat3(uCamWorld) * (v.xyz / v.w);
      pc = uPrevVP * vec4(dir, 0.0);
    } else {
      vec4 v = uInvProj * vec4(ndc, dmin * 2.0 - 1.0, 1.0);
      pc = uPrevVP * (uCamWorld * vec4(v.xyz / v.w, 1.0));
    }
    vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
    if (pc.w <= 0.0 || puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) {
      gl_FragColor = vec4(cur, 1.0);
      return;
    }
    vec3 hs = sampleHistory(puv);
    // bozuk geçmiş (NaN/Inf) → bu pikselde geçmişi bırak
    if (bad(hs)) { gl_FragColor = vec4(cur, 1.0); return; }
    vec3 hist = toY(tmap(clamp(hs, vec3(0.0), vec3(60000.0))));
    // varyans kutusuna kırp (merkeze doğru)
    vec3 c0 = 0.5 * (bmax + bmin);
    vec3 e0 = 0.5 * (bmax - bmin) + 1e-5;
    vec3 v0 = hist - c0;
    vec3 a0 = abs(v0 / e0);
    float ma = max(a0.x, max(a0.y, a0.z));
    if (ma > 1.0) hist = c0 + v0 / ma;
    float motion = length((puv - vUv) / uTexel);
    float alpha = mix(0.085, 0.22, clamp(motion / 12.0, 0.0, 1.0));
    vec3 res = mix(hist, toY(tmap(cur)), alpha);
    gl_FragColor = vec4(safe(itmap(fromY(res))), 1.0);
  }`;

/**
 * Zamansal kenar yumuşatma (TAA): kamera izdüşümü her kare Halton alt piksel ofsetiyle kaydırılır, önceki kareler
 * derinlikten yeniden izdüşürülüp YCoCg varyans kutusuyla kırpılarak biriktirilir. Kenarlar (çit telleri, balkon
 * korkulukları, yaprak kartları) fotoğraftaki gibi titreşimsiz ve alt piksel doğrulukta olur; PCSS/AO gürültüsü de
 * birikir. Hareket vektörü yok → hareketli nesnelerde (araç, yaya) kırpma ile sınırlı hafif iz kalabilir.
 */
export class TAAPass extends Pass {
  private hist: THREE.WebGLRenderTarget[];
  private idx = 0;
  private quad: FullScreenQuad;
  private copyQuad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  private copyMat: THREE.ShaderMaterial;
  private prevVP = new THREE.Matrix4();
  private unjittered = new THREE.Matrix4();
  private frame = 0;
  private jx = 0;
  private jy = 0;
  private lastPos = new THREE.Vector3();
  private lastQuat = new THREE.Quaternion();
  private lastFov = 0;
  reset = true;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly depth: () => THREE.Texture | null,
    w: number,
    h: number,
  ) {
    super();
    const mk = () =>
      new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      });
    this.hist = [mk(), mk()];
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tCurrent: { value: null },
        tHistory: { value: null },
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uPrevVP: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
        uReset: { value: 1 },
      },
      vertexShader: VS,
      fragmentShader: ResolveShader,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.copyQuad = new FullScreenQuad(this.copyMat);
  }

  /** Render öncesi: izdüşüme alt piksel ofseti ekle (arka plan kamerasına da). */
  jitter(w: number, h: number, extra: THREE.PerspectiveCamera[] = []): void {
    const cam = this.camera;
    this.unjittered.copy(cam.projectionMatrix);
    // kamera kesmesi (ışınlanma, karşılaştırma kamerası, tepeden bakış): büyük konum/dönüş/fov değişimi → geçmişi at
    const turn = 2 * Math.acos(Math.min(1, Math.abs(cam.quaternion.dot(this.lastQuat))));
    if (
      cam.position.distanceTo(this.lastPos) > 6 ||
      turn > (35 * Math.PI) / 180 ||
      Math.abs(cam.fov - this.lastFov) > 0.5 ||
      !Number.isFinite(cam.position.x + cam.position.y + cam.position.z)
    )
      this.reset = true;
    this.lastPos.copy(cam.position);
    this.lastQuat.copy(cam.quaternion);
    this.lastFov = cam.fov;
    const j = JITTER[this.frame++ % JITTER.length];
    this.jx = (j[0] * 2) / w;
    this.jy = (j[1] * 2) / h;
    for (const c of [cam, ...extra]) {
      c.projectionMatrix.elements[8] += this.jx;
      c.projectionMatrix.elements[9] += this.jy;
      c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    }
  }

  /** Render sonrası: titretmeyi geri al. */
  unjitter(extra: THREE.PerspectiveCamera[] = []): void {
    for (const c of [this.camera, ...extra]) {
      c.projectionMatrix.elements[8] -= this.jx;
      c.projectionMatrix.elements[9] -= this.jy;
      c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    }
    this.jx = this.jy = 0;
  }

  setSize(w: number, h: number): void {
    for (const t of this.hist) t.setSize(w, h);
    this.mat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.reset = true;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const u = this.mat.uniforms;
    const cam = this.camera;
    u.tCurrent.value = readBuffer.texture;
    u.tHistory.value = this.hist[this.idx].texture;
    u.tDepth.value = this.depth();
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uPrevVP.value.copy(this.prevVP);
    u.uReset.value = this.reset || !u.tDepth.value ? 1 : 0;
    const next = this.hist[1 - this.idx];
    renderer.setRenderTarget(next);
    this.quad.render(renderer);
    this.copyMat.uniforms.tDiffuse.value = next.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copyQuad.render(renderer);
    this.prevVP.multiplyMatrices(this.unjittered, cam.matrixWorldInverse);
    this.idx = 1 - this.idx;
    this.reset = false;
  }

  dispose(): void {
    for (const t of this.hist) t.dispose();
    this.mat.dispose();
    this.copyMat.dispose();
    this.quad.dispose();
    this.copyQuad.dispose();
  }
}

/**
 * Otomatik pozlama (göz/kamera uyumu): kare parlaklığının merkez ağırlıklı log ortalaması GPU'da 64² → 16² → 4² → 1²
 * indirgenir, 1×1 hedefte zamanla uyarlanır (CPU'ya okuma yok). Renk düzeltme geçişi bu değeri okur ve kalibre
 * pozlamaya göre kısmi düzeltme uygular (Street View kamerası gölgeye girince açılır).
 */
export class ExposureMeter {
  private levels: THREE.WebGLRenderTarget[];
  private adapt: THREE.WebGLRenderTarget[];
  private ai = 0;
  private quad = new FullScreenQuad();
  private lumMat: THREE.ShaderMaterial;
  private redMat: THREE.ShaderMaterial;
  private adaptMat: THREE.ShaderMaterial;
  private first = true;

  /** @param fallback ölçüm/uyum bozulursa kullanılacak ln L (kalibre referans → düzeltme 1.0) */
  constructor(private readonly fallback = -1) {
    const mk = (s: number) =>
      new THREE.WebGLRenderTarget(s, s, {
        type: THREE.FloatType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
      });
    this.levels = [mk(64), mk(16), mk(4), mk(1)];
    this.adapt = [mk(1), mk(1)];
    this.lumMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec2 o = vec2(0.25 / 64.0);
          vec3 c = texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb + texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb
            + texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, vUv - o).rgb;
          float l = dot(c * 0.25, vec3(0.2126, 0.7152, 0.0722));
          // NaN/Inf örnek ölçüme girmesin (ağırlık 0) — tek bozuk piksel uyarlanmış değeri kalıcı bozardı
          if (isnan(l) || isinf(l)) { gl_FragColor = vec4(0.0); return; }
          l = clamp(l, 1e-4, 6.0);
          // merkez ağırlıklı ölçüm (fotoğraf makinesi gibi): kenarlar %35
          vec2 d = (vUv - 0.5) * 2.0;
          float w = mix(1.0, 0.35, smoothstep(0.2, 1.0, dot(d, d)));
          gl_FragColor = vec4(log(l) * w, w, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.redMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSrc: { value: 64 } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform float uSrc; varying vec2 vUv;
        void main() {
          vec2 dst = floor(vUv * uSrc / 4.0);
          vec2 s = vec2(0.0);
          for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++)
            s += texture2D(tDiffuse, (dst * 4.0 + vec2(float(x), float(y)) + 0.5) / uSrc).rg;
          gl_FragColor = vec4(s, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      uniforms: { tCur: { value: null }, tPrev: { value: null }, uK: { value: 1 }, uFallback: { value: -1 } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `uniform sampler2D tCur; uniform sampler2D tPrev; uniform float uK, uFallback;
        varying vec2 vUv;
        void main() {
          vec2 s = texture2D(tCur, vec2(0.5)).rg;
          float prev = texture2D(tPrev, vec2(0.5)).r;
          bool prevBad = isnan(prev) || isinf(prev);
          // ölçülecek geçerli piksel yoksa (tümü ayıklandı) önceki değerde kal
          float cur = s.y > 1e-3 ? s.x / s.y : (prevBad ? uFallback : prev);
          if (isnan(cur) || isinf(cur)) cur = prevBad ? uFallback : prev;
          if (prevBad) prev = cur;
          gl_FragColor = vec4(clamp(mix(prev, cur, uK), -12.0, 4.0), 0.0, 0.0, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.adaptMat.uniforms.uFallback.value = this.fallback;
  }

  /** Sonraki ölçümde uyum beklemeden doğrudan ayarla (ışınlanma / kamera sıçraması). */
  snap(): void {
    this.first = true;
  }

  /** Uyarlanmış log parlaklık dokusu (r = ln L). */
  get texture(): THREE.Texture {
    return this.adapt[this.ai].texture;
  }

  get target(): THREE.WebGLRenderTarget {
    return this.adapt[this.ai];
  }

  update(renderer: THREE.WebGLRenderer, src: THREE.Texture, dt: number): void {
    this.quad.material = this.lumMat;
    this.lumMat.uniforms.tDiffuse.value = src;
    renderer.setRenderTarget(this.levels[0]);
    this.quad.render(renderer);
    this.quad.material = this.redMat;
    for (let i = 1; i < this.levels.length; i++) {
      this.redMat.uniforms.tDiffuse.value = this.levels[i - 1].texture;
      this.redMat.uniforms.uSrc.value = this.levels[i - 1].width;
      renderer.setRenderTarget(this.levels[i]);
      this.quad.render(renderer);
    }
    const next = 1 - this.ai;
    this.quad.material = this.adaptMat;
    this.adaptMat.uniforms.tCur.value = this.levels[3].texture;
    this.adaptMat.uniforms.tPrev.value = this.adapt[this.ai].texture;
    // ~0.8 s zaman sabiti (kamera otomatik pozlaması gibi hızlı ama yumuşak)
    this.adaptMat.uniforms.uK.value = this.first ? 1 : 1 - Math.exp(-Math.min(dt, 0.25) / 0.8);
    this.first = false;
    renderer.setRenderTarget(this.adapt[next]);
    this.quad.render(renderer);
    this.ai = next;
  }

  dispose(): void {
    for (const t of [...this.levels, ...this.adapt]) t.dispose();
    this.lumMat.dispose();
    this.redMat.dispose();
    this.adaptMat.dispose();
    this.quad.dispose();
  }
}
