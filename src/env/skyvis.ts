import * as THREE from 'three';
import { nightUniform } from './night';

/**
 * Zemin gök görüşü (yatay yüzeylerde dolaylı ışığın gökyüzü örtünmesi).
 *
 * Neden (2026-10-01, D4 eleştirmen r3 #4 + Street View güneş/gölge ölçümü, scratchpad/d4r3fix/shade): aynı
 * fotoğrafta güneşli ve gölgeli aynı zemin çiftleri:
 * - açık gölge (direk / lamba kolu / seyrek ağaç gölgesi, gök neredeyse tamamen açık): 5 çift, −2.25 … −2.42 durak
 *   (ort. −2.32);
 * - duvar / çit dibi gölgesi (gökyüzünün yarısı duvar + çit): Mertkent kuzey kapı −2.66, 95 blok −3.11 durak.
 * Oyunda yarım küre ışığı + ortam haritası hiçbir yerde örtülmüyor (N8AO yalnız 1.6 m): açık gölge −2.74 … −2.85,
 * duvar dibi −2.23 / −2.61 → iki sınıf arasında fark yok; tek bir sabit (yarım küre / ortam ölçeği) birini
 * düzeltirken ötekini bozuyor (geçmiş 2–3'te duvar dibine göre düşürülmüştü → açık gölge 0.45 durak koyu).
 *
 * Yöntem: oyuncunun çevresi (±80 m) yukarıdan dik izdüşümle bir yükseklik haritasına çizilir (opak meshler; ağaç
 * yaprakları, saydamlar, iskeletli figürler hariç). Yukarı bakan her parça için 8 yönde ufuk açısı (0.4 … 25.6 m)
 * örneklenir; kosinüs ağırlıklı açık gök oranı v = 1 − ort(sin² ufuk). Üstü kapalıysa (balkon altı, saçak, durak)
 * v = kapalı değeri. Yalnız dolaylı ışık (yarım küre + ortam) `k · v` ile çarpılır, güneş değişmez. Düşey yüzeyler
 * (cepheler) etkilenmez — onların kalibrasyonu (açık cephe gölgesi, ±0.3 durak) ayrı ve korunur.
 * Pişirilmiş AO taşıyan malzemelerde (aoMap / zemin AO dokusu) örtünme zaten pişirilmiş: yalnız k · açık değer.
 * Yüksek + Ultra kalitede; Düşük/Orta değişmez. `?skyvis=0` kapatır, `?svk=` k, `?svc=` kapalı değeri.
 */

const q = () => new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const num = (key: string, def: number) => {
  const p = q();
  const v = Number(p.get(key));
  return p.has(key) && Number.isFinite(v) ? v : def;
};

/** Yükseklik haritası yarı genişliği (m) ve çözünürlüğü */
export const SKYVIS_HALF = 80;
const RES = 1024;
/** Ufuk örnek uzaklıkları: 0.4 · 2^j (m) */
export const SKYVIS_STEPS = 7;
export const SKYVIS_DIRS = 8;

/**
 * KARAR (kalibrasyon, scratchpad/d4r3fix/shade): k = 1.5 — açık gölge (v ≈ 0.9) dolaylı ışığı ×1.37 (+0.45 durak),
 * duvar dibi (v ≈ 0.5) ×0.75; kapalı 0.45 (saçak / durak altı); harita dışı / pişirilmiş: v = 0.9.
 */
export function skyVisParams(): { k: number; covered: number; open: number } {
  return { k: num('svk', 1.5), covered: num('svc', 0.45), open: num('svo', 0.9) };
}

export const skyVisUniforms = {
  uSkyH: { value: null as THREE.Texture | null },
  /** batı x, güney z (en büyük z), 1/boyut, etkin (0/1) */
  uSkyRect: { value: new THREE.Vector4(0, 0, 1, 0) },
  /** k, kapalı v, açık (varsayılan) v, - */
  uSkyK: { value: new THREE.Vector4(1, 0.45, 0.9, 0) },
  /** Haritadaki yükseklikler bu kota göre (yarım kayan noktada 100 m kotta 6 cm basamak olmasın) */
  uSkyY: { value: 0 },
};

/**
 * Başvuru (birim testi + GLSL ile aynı): yükseklik örnekleyici h(dx, dz) (parçaya göre), parça kotu y.
 * Döner: kosinüs ağırlıklı açık gök oranı.
 */
export function horizonVisibility(h: (dx: number, dz: number) => number, y: number, covered: number): number {
  if (h(0, 0) > y + 0.6) return covered;
  let occ = 0;
  for (let i = 0; i < SKYVIS_DIRS; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / SKYVIS_DIRS;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let t = 0;
    for (let j = 0; j < SKYVIS_STEPS; j++) {
      const s = 0.4 * 2 ** j;
      t = Math.max(t, (h(dx * s, dz * s) - y - 0.05) / s);
    }
    occ += (t * t) / (1 + t * t);
  }
  return 1 - occ / SKYVIS_DIRS;
}

const VERT_PARS = 'varying vec3 vSkyWp;';
const VERT = /* glsl */ `
  {
    vec4 skyWp = vec4( transformed, 1.0 );
    #ifdef USE_BATCHING
      skyWp = batchingMatrix * skyWp;
    #endif
    #ifdef USE_INSTANCING
      skyWp = instanceMatrix * skyWp;
    #endif
    vSkyWp = ( modelMatrix * skyWp ).xyz;
  }`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uSkyH;
uniform vec4 uSkyRect;
uniform vec4 uSkyK;
uniform float uSkyY;
varying vec3 vSkyWp;
float skyVisAt( vec3 wp ) {
  vec3 p = vec3( wp.x, wp.y - uSkyY, wp.z );
  // doku: x → doğu, v → kuzey (yukarıdan bakan kameranın ekran üstü kuzey)
  vec2 uv0 = vec2( p.x - uSkyRect.x, uSkyRect.y - p.z ) * uSkyRect.z;
  vec2 e = min( uv0, 1.0 - uv0 );
  // harita kenarına yaklaşınca (son ~%20, en uzun örnek 25.6 m) açık değere yumuşak geçiş
  float edge = clamp( ( min( e.x, e.y ) - 0.02 ) * 6.0, 0.0, 1.0 ) * uSkyRect.w;
  if ( edge <= 0.0 ) return uSkyK.z;
  if ( texture2D( uSkyH, uv0 ).r > p.y + 0.6 ) return mix( uSkyK.z, uSkyK.y, edge );
  float occ = 0.0;
  for ( int i = 0; i < ${SKYVIS_DIRS}; i ++ ) {
    float a = ( float( i ) + 0.5 ) * ${((2 * Math.PI) / SKYVIS_DIRS).toFixed(6)};
    vec2 d = vec2( cos( a ), sin( a ) ) * uSkyRect.z;
    float t = 0.0;
    float s = 0.4;
    for ( int j = 0; j < ${SKYVIS_STEPS}; j ++ ) {
      t = max( t, ( texture2D( uSkyH, uv0 + d * s ).r - p.y - 0.05 ) / s );
      s *= 2.0;
    }
    occ += t * t / ( 1.0 + t * t );
  }
  return mix( uSkyK.z, 1.0 - occ / ${SKYVIS_DIRS.toFixed(1)}, edge );
}`;

/** aomap_fragment sonrası: yalnız dolaylı ışık, yalnız yukarı bakan yüzeyler. */
function fragCode(baked: boolean): string {
  return /* glsl */ `
  {
    // skyVisFactor (env/skyvis.ts)
    vec3 skyN = inverseTransformDirection( normal, viewMatrix );
    float skyW = smoothstep( 0.5, 0.9, skyN.y );
    if ( skyW > 0.0 ) {
      ${
        baked
          ? 'float skyV = uSkyK.z;'
          : `#ifdef USE_AOMAP
      float skyV = uSkyK.z;
      #else
      float skyV = skyVisAt( vSkyWp );
      #endif`
      }
      float skyF = mix( 1.0, uSkyK.x * skyV, skyW );
      reflectedLight.indirectDiffuse *= skyF;
      reflectedLight.indirectSpecular *= skyF;
      if ( uSkyK.w > 0.5 ) {
        // ?svdbg=1: yukarı bakan yüzeylerde v (gri) — hata ayıklama
        reflectedLight.directDiffuse = vec3( 0.0 );
        reflectedLight.directSpecular = vec3( 0.0 );
        reflectedLight.indirectSpecular = vec3( 0.0 );
        reflectedLight.indirectDiffuse = vec3( skyV * skyW * 0.3 );
      }
    }
  }`;
}

const patched = new WeakSet<THREE.Material>();

function patchable(m: THREE.Material): boolean {
  return (
    m instanceof THREE.MeshStandardMaterial ||
    m instanceof THREE.MeshLambertMaterial ||
    m instanceof THREE.MeshPhongMaterial
  );
}

/** Malzemeye gök görüşü çarpanını ekler (mevcut onBeforeCompile / önbellek anahtarı zincirlenir). */
export function patchSkyVis(m: THREE.Material): boolean {
  if (patched.has(m) || !patchable(m)) return false;
  patched.add(m);
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    // klon (ör. pişirilmiş AO klonu) onBeforeCompile'ı kopyalamış olabilir → iki kez ekleme
    if (sh.fragmentShader.includes('skyVisFactor')) return;
    if (!sh.fragmentShader.includes('#include <aomap_fragment>')) return;
    Object.assign(sh.uniforms, skyVisUniforms);
    const baked = 'groundAoMap' in sh.uniforms;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>${VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>${fragCode(baked)}`);
  };
  // önceki anahtar, önceki onBeforeCompile ile hesaplanır (three'nin varsayılanı onBeforeCompile.toString())
  m.customProgramCacheKey = function () {
    const cur = this.onBeforeCompile;
    this.onBeforeCompile = prev;
    try {
      return `${prevKey.call(this)}|skyvis`;
    } finally {
      this.onBeforeCompile = cur;
    }
  };
  m.needsUpdate = true;
  return true;
}

/** Yükseklik haritası çizimi: dünya y'si (en üstteki yüzey). */
const heightMat = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    #include <common>
    #include <batching_pars_vertex>
    uniform float uRefY;
    varying float vY;
    void main() {
      #include <batching_vertex>
      #include <begin_vertex>
      vec4 wp = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        wp = batchingMatrix * wp;
      #endif
      #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
      #endif
      wp = modelMatrix * wp;
      vY = wp.y - uRefY;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    varying float vY;
    void main() { gl_FragColor = vec4( vY, 0.0, 0.0, 1.0 ); }`,
  uniforms: { uRefY: { value: 0 } },
  side: THREE.DoubleSide,
});

/** Yükseklik haritasına girmeyenler: yaprak kartları / saydamlar / iskeletli figürler / çizgi, nokta. */
function excluded(o: THREE.Object3D): boolean {
  if (o.userData.noSkyOcc) return true;
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return true;
  if ((o as THREE.SkinnedMesh).isSkinnedMesh) return true;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some((m) => !m || m.transparent || m.alphaTest > 0 || !m.depthWrite || !m.colorWrite);
}

export class SkyVisibility {
  readonly enabled: boolean;
  private rt: THREE.WebGLRenderTarget | null = null;
  private cam = new THREE.OrthographicCamera(-SKYVIS_HALF, SKYVIS_HALF, SKYVIS_HALF, -SKYVIS_HALF, 1, 3000);
  private center = new THREE.Vector2(Infinity, Infinity);
  private scanTimer = 0;
  private dirty = true;
  private params = skyVisParams();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    enabled: boolean,
  ) {
    this.enabled = enabled && q().get('skyvis') !== '0';
    const p = this.params;
    skyVisUniforms.uSkyK.value.set(p.k, p.covered, p.open, q().has('svdbg') ? 1 : 0);
    if (!this.enabled) return;
    this.rt = new THREE.WebGLRenderTarget(RES, RES, {
      // 32 bit yazılabiliyorsa (WebGL2 + EXT_color_buffer_float) tam kayan nokta
      type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.rt.texture.name = 'skyvis-height';
    skyVisUniforms.uSkyH.value = this.rt.texture;
    this.cam.up.set(0, 0, -1);
  }

  /** Dünya değişince: tüm malzemeleri yamala, haritayı yeniden çiz. */
  reset(): void {
    this.dirty = true;
    this.scanTimer = 0;
  }

  /** Sahnedeki yeni malzemeleri yamala (akışla gelen parçalar için periyodik). */
  private scan(): void {
    this.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats || !(o as THREE.Mesh).isMesh) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) patchSkyVis(m);
    });
  }

  /** Her kare: kamera 20 m'den fazla kaydıysa / dünya değiştiyse yükseklik haritasını yeniden çiz. */
  update(at: THREE.Vector3, dt: number): void {
    if (!this.enabled || !this.rt) return;
    // k gündüz kalibrasyonu; gece açık zemin değişmesin (k → 1/açık), örtünme farkı kalsın
    const p = this.params;
    skyVisUniforms.uSkyK.value.x = THREE.MathUtils.lerp(p.k, 1 / p.open, nightUniform.value);
    this.scanTimer -= dt;
    if (this.dirty || this.scanTimer <= 0) {
      this.scan();
      this.scanTimer = 2;
    }
    // harita her 3 m ızgaraya oturur (titreme yok); 20 m kayınca yeniden çizilir
    if (!this.dirty && Math.hypot(at.x - this.center.x, at.z - this.center.y) < 20) return;
    this.dirty = false;
    const cx = Math.round(at.x / 3) * 3;
    const cz = Math.round(at.z / 3) * 3;
    this.center.set(cx, cz);
    const refY = Math.round(at.y);
    heightMat.uniforms.uRefY.value = refY;
    this.cam.position.set(cx, 1500, cz);
    this.cam.lookAt(cx, 0, cz);
    this.cam.updateMatrixWorld();
    const r = this.renderer;
    const hidden: THREE.Object3D[] = [];
    this.scene.traverseVisible((o) => {
      if (o === this.scene || !(o as THREE.Mesh).isMesh) return;
      if (excluded(o)) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    const prevTarget = r.getRenderTarget();
    const prevOverride = this.scene.overrideMaterial;
    const prevAuto = r.autoClear;
    const prevBg = this.scene.background;
    const prevFog = this.scene.fog;
    const shadowAuto = r.shadowMap.autoUpdate;
    const clear = r.getClearColor(new THREE.Color());
    const clearA = r.getClearAlpha();
    try {
      this.scene.overrideMaterial = heightMat;
      this.scene.background = null;
      this.scene.fog = null;
      r.shadowMap.autoUpdate = false;
      r.setRenderTarget(this.rt);
      r.setClearColor(new THREE.Color(-1000, 0, 0), 1);
      r.autoClear = true;
      r.clear();
      r.render(this.scene, this.cam);
    } finally {
      for (const o of hidden) o.visible = true;
      this.scene.overrideMaterial = prevOverride;
      this.scene.background = prevBg;
      this.scene.fog = prevFog;
      r.shadowMap.autoUpdate = shadowAuto;
      r.setClearColor(clear, clearA);
      r.autoClear = prevAuto;
      r.setRenderTarget(prevTarget);
    }
    // kamera yukarı vektörü −Z: ekran sağı doğu, üstü kuzey → doku v = (güney z − z) / boyut
    skyVisUniforms.uSkyRect.value.set(cx - SKYVIS_HALF, cz + SKYVIS_HALF, 1 / (2 * SKYVIS_HALF), 1);
    skyVisUniforms.uSkyY.value = refY;
  }
}
