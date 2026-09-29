import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * Ultra, isteğe bağlı (?sky=hdri): gerçek fotoğraf gökyüzü (Poly Haven CC0 "puresky" HDRI, `scripts/fetch-textures.mjs`
 * Actions'ta indirir → public/textures/sky/sky.hdr). Yalnız ARKA PLAN ve cam yansıması; ortam aydınlatması kalibre
 * prosedürel gökten kalır (Street View kalibrasyonu bozulmasın).
 * - Güneş hizası: HDRI'deki en parlak piksel = güneş; azimutu oyundaki güneş azimutuna döndürülür (yükseklik farkı
 *   düzeltilemez — HDRI güneşi ~45–50° seçildi).
 * - Parlaklık: güneşten uzak üç yönde (yükseklik 35°) prosedürel gök ile HDRI ortalaması eşitlenir.
 * - Bulut gölgesi HDRI bulutlarıyla eşleşmez → bu modda kapalı.
 * KARAR: varsayılan prosedürel (bulutlar ve yer gölgeleri tutarlı); HDRI bu ortamda indirilemediği için sahada
 * görsel olarak doğrulanmadı.
 */
export interface HdriSky {
  mesh: THREE.Mesh;
  /** Oyundaki güneş azimutuna göre döndür ve parlaklığı prosedürel göğe eşitle. */
  align(sunAzimuthDeg: number, measureProc: (dirs: THREE.Vector3[]) => number): void;
}

const VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w;
  }`;
const FS = /* glsl */ `
  uniform sampler2D tSky;
  uniform float uRot;
  uniform float uScale;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float az = atan(d.x, -d.z);
    float el = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(fract((az - uRot) / 6.283185307 + 0.5), 0.5 + el / 3.141592653);
    vec3 c = texture2D(tSky, uv).rgb * uScale;
    // ufkun altı: HDRI'nin alt yarısı boş olabilir → ufuk rengini uzat
    if (d.y < 0.0) c = texture2D(tSky, vec2(uv.x, 0.502)).rgb * uScale;
    gl_FragColor = vec4(c, 1.0);
  }`;

export async function loadHdriSky(url: string): Promise<HdriSky | null> {
  let tex: THREE.DataTexture;
  try {
    tex = (await new HDRLoader().setDataType(THREE.FloatType).loadAsync(url)) as THREE.DataTexture;
  } catch (e) {
    console.warn('[ultra] HDRI gökyüzü yok/yüklenemedi, prosedürel gök kullanılıyor', e);
    return null;
  }
  const img = tex.image as { data: Float32Array; width: number; height: number };
  const { data, width: W, height: H } = img;
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  // Veri satırı 0 = görüntünün üstü; flipY kapalı → v = 0 üst. Gölgelendiricide v = 0.5 + el/π: bu yüzden
  // satırları dikeyde çevir (v=1 üst olsun).
  const row = W * 4;
  const tmp = new Float32Array(row);
  for (let y = 0; y < H / 2; y++) {
    const a = y * row;
    const b = (H - 1 - y) * row;
    tmp.set(data.subarray(a, a + row));
    data.copyWithin(a, b, b + row);
    data.set(tmp, b);
  }
  // Güneş: üst yarıdaki en parlak piksel (v > 0.5)
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = Math.floor(H / 2); y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (l > best) {
        best = l;
        bx = x;
        by = y;
      }
    }
  const sunAz = ((bx + 0.5) / W - 0.5) * 360;
  const sunEl = ((by + 0.5) / H - 0.5) * 180;
  console.info(`[ultra] HDRI güneşi: azimut ${sunAz.toFixed(1)}°, yükseklik ${sunEl.toFixed(1)}°`);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tSky: { value: tex }, uRot: { value: 0 }, uScale: { value: 1 } },
    vertexShader: VS,
    fragmentShader: FS,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(40000, 64, 32), mat);
  mesh.name = 'hdri-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  const sample = (azDeg: number, elDeg: number) => {
    const u = (((azDeg / 360 + 0.5) % 1) + 1) % 1;
    const v = 0.5 + elDeg / 180;
    let s = 0;
    let n = 0;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const x = (Math.floor(u * W) + dx + W) % W;
        const y = Math.min(H - 1, Math.max(0, Math.floor(v * H) + dy));
        const i = (y * W + x) * 4;
        s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        n++;
      }
    return s / n;
  };
  const align = (gameAz: number, measureProc: (dirs: THREE.Vector3[]) => number) => {
    const rot = gameAz - sunAz;
    mat.uniforms.uRot.value = (rot * Math.PI) / 180;
    // güneşten uzak, gökyüzünün mavi bandı: güneşe göre +90°, 180°, −90°, yükseklik 35°
    const rel = [90, 180, 270];
    const hd = rel.reduce((a, r) => a + sample(sunAz + r, 35), 0) / rel.length;
    const dirs = rel.map((r) => {
      const az = ((gameAz + r) * Math.PI) / 180;
      const el = (35 * Math.PI) / 180;
      return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    });
    const pr = measureProc(dirs);
    if (hd > 0 && pr > 0) mat.uniforms.uScale.value = pr / hd;
    console.info(`[ultra] HDRI parlaklık ölçeği ${mat.uniforms.uScale.value.toExponential(3)}`);
  };
  return { mesh, align };
}

/** Prosedürel göğün verilen yönlerdeki ortalama parlaklığı (dar açılı kamera, 4×4 kayan noktalı hedef). */
export function measureSky(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  dirs: THREE.Vector3[],
  at: THREE.Vector3,
): number {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType, depthBuffer: true });
  const cam = new THREE.PerspectiveCamera(8, 1, 1, 100000);
  const buf = new Float32Array(4 * 16);
  const prev = renderer.getRenderTarget();
  let sum = 0;
  for (const d of dirs) {
    cam.position.copy(at);
    cam.lookAt(at.clone().add(d));
    cam.updateMatrixWorld();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, 4, 4, buf);
    let s = 0;
    for (let i = 0; i < 16; i++) s += 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    sum += s / 16;
  }
  renderer.setRenderTarget(prev);
  rt.dispose();
  return sum / dirs.length;
}
