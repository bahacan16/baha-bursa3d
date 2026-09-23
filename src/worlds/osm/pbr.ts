import * as THREE from 'three';

/**
 * CC0 foto-taramalı PBR dokular (public/textures, Poly Haven). Dokular "detay" olarak kullanılır:
 * renk = köşe rengi × (doku / doku ortalaması) → tasarlanan renk korunur, gerçek yüzey dokusu eklenir.
 */
export type PbrRole = 'asphalt' | 'paving' | 'concrete' | 'plaster' | 'roof' | 'grass' | 'dirt' | 'bark';

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  /** Doku ortalama rengi (doğrusal), yükleme sonrası güncellenir. */
  avg: { value: THREE.Color };
  /** Dokunun kapladığı gerçek boyut (m). */
  size: number;
}

const SIZES: Record<PbrRole, number> = {
  asphalt: 3,
  paving: 2,
  concrete: 2,
  plaster: 2,
  roof: 2,
  grass: 3,
  dirt: 1.3,
  bark: 1,
};

const loader = new THREE.TextureLoader();

function averageColor(img: CanvasImageSource, out: THREE.Color): void {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    out.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    /* ortalama alınamazsa gri kalır */
  }
}

export function loadPbr(base: string, role: PbrRole, withMaps: boolean): PbrSet {
  const avg = { value: new THREE.Color(0.5, 0.5, 0.5) };
  const tex = (name: string, srgb: boolean) => {
    const t = loader.load(
      `${base}textures/${role}/${name}.jpg`,
      (tt) => {
        if (name === 'diffuse') averageColor(tt.image as CanvasImageSource, avg.value);
      },
      undefined,
      () => console.warn(`doku yüklenemedi: ${role}/${name}`),
    );
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    const s = 1 / SIZES[role];
    t.repeat.set(s, s);
    return t;
  };
  return {
    map: tex('diffuse', true),
    normalMap: withMaps ? tex('normal', false) : null,
    roughnessMap: withMaps ? tex('rough', false) : null,
    avg,
    size: SIZES[role],
  };
}

/** Standart malzemeye "detay" haritası uygular (map_fragment yerine göreli çarpım). */
export function detailMaterial(
  set: PbrSet,
  opts: { roughness?: number; normalScale?: number; strength?: number; polygonOffset?: number; key: string },
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: opts.roughness ?? 1,
    metalness: 0,
  });
  if (set.normalMap) m.normalScale.setScalar(opts.normalScale ?? 1);
  if (opts.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = opts.polygonOffset;
    m.polygonOffsetUnits = opts.polygonOffset;
  }
  const strength = opts.strength ?? 1;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAvg = set.avg;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAvg;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 dTex = texture2D(map, vMapUv);
  diffuseColor.rgb *= mix(vec3(1.0), clamp(dTex.rgb / max(uAvg, vec3(0.02)), 0.0, 2.5), ${strength.toFixed(2)});
#endif`,
      );
  };
  m.customProgramCacheKey = () => `detail-${opts.key}`;
  return m;
}
