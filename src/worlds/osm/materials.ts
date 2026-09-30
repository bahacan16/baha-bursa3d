import * as THREE from 'three';
import type { MatKey } from './chunks';
import { createFacadeAtlas, createFacadeMaterial } from './facades';
import { detailMaterial, loadPbr, type PbrRole } from './pbr';
import type { Quality } from '../../core/settings';

function canvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * KARAR: Nilüfer kaldırımı (yer fotoğrafları): gri beton tuğla 10×20 cm, uzun kenar yol boyunca, şaşırtmalı;
 * ortada 40 cm sarı kılavuz karo (yürüme yönünde kabartma çubuklar). UV: u = yoldan uzaklık (0..SIDEWALK_W m),
 * v = yol boyunca metre → doku 2 m × 1.2 m (3 karo).
 */
function nilueferSidewalk(): THREE.CanvasTexture {
  const PPM = 200;
  const W = 2 * PPM;
  const H = 1.2 * PPM;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  let seed = 91;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#6d6a66';
  g.fillRect(0, 0, W, H);
  const bw = 0.1 * PPM;
  const bl = 0.2 * PPM;
  for (let col = 0; col < W / bw; col++) {
    const x = col * bw;
    if (x >= 0.8 * PPM - 1 && x < 1.2 * PPM - 1) continue;
    const off = col % 2 ? bl / 2 : 0;
    for (let y = -bl; y < H + bl; y += bl) {
      const l = 58 + (r() - 0.5) * 12;
      g.fillStyle = `hsl(${30 + r() * 20},${3 + r() * 4}%,${l}%)`;
      g.fillRect(x + 1.5, y + off + 1.5, bw - 3, bl - 3);
    }
  }
  // Kılavuz karolar (40 cm): hardal sarısı, 6 uzun çubuk
  for (let y = 0; y < H; y += 0.4 * PPM) {
    const x0 = 0.8 * PPM;
    const s = 0.4 * PPM;
    g.fillStyle = '#9a773a';
    g.fillRect(x0, y, s, s);
    g.fillStyle = '#a8894a';
    g.fillRect(x0 + 2, y + 2, s - 4, s - 4);
    for (let k = 0; k < 6; k++) {
      const cx = x0 + 6 + ((s - 12) * (k + 0.5)) / 6;
      g.fillStyle = '#b89656';
      g.fillRect(cx - 3.5, y + 8, 7, s - 16);
      g.fillStyle = '#8f6d33';
      g.fillRect(cx + 3.5, y + 8, 1.5, s - 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(0.5, 1 / 1.2);
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, s: number, base: string, amount: number, seed = 7) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  let x = seed;
  const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < s * s * amount; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.08})`;
    const w = 1 + r() * 2;
    ctx.fillRect(r() * s, r() * s, w, w);
  }
}

export interface OsmMaterials {
  byKey: Record<MatKey, THREE.Material>;
  /** Araç yolu asfaltının köşe rengi olmadan (el modeli dolguları için) */
  roadFill: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  trees: THREE.MeshStandardMaterial;
  dispose(): void;
}

/** Arazide çizilmeyecek dikdörtgenler (minX, minZ, maxX, maxZ) — el modeli havuzları için */
export const groundHoles = {
  value: [0, 1, 2, 3].map(() => new THREE.Vector4(1, 1, 0, 0)),
};
export const groundHalf = { value: 1300 };
/**
 * v8 ölçülmüş zemin maskesi (world.setSurveyGround): kaldırım / ada / sokak alanı çokgenleri, dünya dikdörtgeni
 * `surveyRect` (x0, z0, x1, z1) üzerinde R kanalı. Maske içinde hava fotoğrafının koyu gölgesi çime çevrilmez, çim /
 * toprak foto detayı yok, renk nötre çekilir (critic d4a #2/#12: kule gölgesi yeşil çim, şerit arası bej toprak).
 * Dikdörtgen boşsa (x1 ≤ x0) etkisiz → ölçülmemiş yerde arazi aynı.
 */
export const surveyMask = { value: null as THREE.Texture | null };
export const surveyRect = { value: new THREE.Vector4(0, 0, 0, 0) };

export function createOsmMaterials(quality: Quality, base = import.meta.env.BASE_URL): OsmMaterials {
  // Gerçek foto-taramalı dokular (CC0). Düşük kalitede yalnızca renk dokusu (bellek).
  const maps = quality !== 'low';
  const P = (r: PbrRole) => loadPbr(base, r, maps);
  const asphalt = P('asphalt');
  const paving = P('paving');
  const concrete = P('concrete');
  const roofTiles = P('roof');
  const grassT = P('grass');
  const dirtT = P('dirt');
  const plasterT = P('plaster');
  const pbrSets = [asphalt, paving, concrete, roofTiles, grassT, dirtT, plasterT];
  const atlas = createFacadeAtlas(quality === 'low' ? 1024 : 2048);
  // Beyaz tabanlı hafif gren: köşe renklerini çarpar (vertex color).
  const grain = canvasTexture(256, (ctx, s) => speckle(ctx, s, '#ffffff', 0.5));
  grain.repeat.set(0.25, 0.25);
  const sidewalkTex = canvasTexture(256, (ctx, s) => {
    speckle(ctx, s, '#ffffff', 0.3, 11);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 3;
    const n = 4;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo((i * s) / n, 0);
      ctx.lineTo((i * s) / n, s);
      ctx.moveTo(0, (i * s) / n);
      ctx.lineTo(s, (i * s) / n);
      ctx.stroke();
    }
  });
  sidewalkTex.repeat.set(0.5, 0.5);
  const pitchTex = canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#c9d8c0';
    ctx.fillRect(0, 0, s / 2, s);
  });
  pitchTex.repeat.set(0.1, 0.1);
  // Arazi: alan kullanımı dokusu (world.ts atar) × yakın mesafe gren detayı
  const detailTex = canvasTexture(256, (ctx, sz) => {
    speckle(ctx, sz, '#ffffff', 1.2, 3);
    let x = 5;
    const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.06})`;
      ctx.beginPath();
      ctx.arc(r() * sz, r() * sz, 3 + r() * 14, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  detailTex.colorSpace = THREE.NoColorSpace;

  const flat = (map: THREE.Texture | null, offset: number, roughness = 0.95) =>
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map,
      roughness,
      metalness: 0,
      polygonOffset: offset !== 0,
      polygonOffsetFactor: offset,
      polygonOffsetUnits: offset,
    });

  const byKey: Record<MatKey, THREE.Material> = {
    wall: createFacadeMaterial(atlas, plasterT),
    roof: detailMaterial(concrete, { key: 'roof', roughness: 1, normalScale: 0.6 }),
    roofTile: detailMaterial(roofTiles, { key: 'roofTile', roughness: 1, normalScale: 1 }),
    detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }),
    landLow: flat(grain, -1),
    landHigh: flat(grain, -2),
    pitch: flat(pitchTex, -3, 0.9),
    water: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.15,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
    roadMinor: detailMaterial(asphalt, { key: 'roadMinor', polygonOffset: -4, normalScale: 0.8 }),
    roadMajor: detailMaterial(asphalt, { key: 'roadMajor', polygonOffset: -5, normalScale: 0.8 }),
    footway: detailMaterial(paving, { key: 'footway', polygonOffset: -4, normalScale: 1 }),
    marking: flat(null, -7, 0.7),
    sidewalk: new THREE.MeshStandardMaterial({ vertexColors: true, map: nilueferSidewalk(), roughness: 0.9 }),
    rail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 }),
    barrier: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  };
  const ground = new THREE.MeshStandardMaterial({ roughness: 1 });
  ground.onBeforeCompile = (sh) => {
    sh.uniforms.groundHoles = groundHoles;
    sh.uniforms.groundHalf = groundHalf;
    if (!surveyMask.value) {
      const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      t.needsUpdate = true;
      surveyMask.value = t;
    }
    sh.uniforms.surveyMask = surveyMask;
    sh.uniforms.surveyRect = surveyRect;
    sh.uniforms.detailMap = { value: detailTex };
    sh.uniforms.grassMap = { value: grassT.map };
    sh.uniforms.dirtMap = { value: dirtT.map };
    sh.uniforms.grassAvg = grassT.avg;
    sh.uniforms.dirtAvg = dirtT.avg;
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec4 groundHoles[4];\nuniform float groundHalf;\nuniform sampler2D detailMap;\nuniform sampler2D grassMap;\nuniform sampler2D dirtMap;\nuniform vec3 grassAvg;\nuniform vec3 dirtAvg;\nuniform sampler2D surveyMask;\nuniform vec4 surveyRect;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
  // El modeli çukurları (havuz): arazi burada çizilmez
  vec2 wxz = vec2(vMapUv.x, 1.0 - vMapUv.y) * (2.0 * groundHalf) - groundHalf;
  for (int i = 0; i < 4; i++) {
    vec4 h = groundHoles[i];
    if (wxz.x > h.x && wxz.x < h.z && wxz.y > h.y && wxz.y < h.w) discard;
  }
  // Yakın mesafe: gerçek çim / toprak foto dokusu (alan rengi yeşilse çim), uzakta sönümlenir.
  // Doku alanı 2.6 km → uv * 2600 = metre
  vec2 wm = vMapUv * 2600.0;
  // Hava fotoğrafındaki ağaç taçları/gölgeleri (neredeyse siyah yeşil) zemin değil: 3B ağaçlar ve gölgeleri
  // zaten var → koyu yeşilimsi pikseller çim tonuna çekilir (Street View'da ağaç altı aydınlık çim/toprak)
  // Ölçülmüş zemin maskesi (kaldırım / ada / sokak alanı): gölge → çim dönüşümü ve çim dokusu yok, renk nötr
  float sm = 0.0;
  if (surveyRect.z > surveyRect.x) {
    vec2 su = (wxz - surveyRect.xy) / (surveyRect.zw - surveyRect.xy);
    if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) sm = texture2D(surveyMask, su).r;
  }
  float lum0 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum0) * vec3(1.0, 0.99, 0.965), sm * 0.75);
  float canopy = (1.0 - smoothstep(0.025, 0.07, lum0)) * step(diffuseColor.r, diffuseColor.g * 1.15) * (1.0 - sm);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.19, 0.06), canopy * 0.85);
  vec3 base = diffuseColor.rgb;
  float green = clamp((base.g - max(base.r, base.b)) * 12.0, 0.0, 1.0) * (1.0 - sm);
  vec3 gT = texture2D(grassMap, wm / 3.0).rgb / max(grassAvg, vec3(0.02));
  vec3 dT = texture2D(dirtMap, wm / 1.3).rgb / max(dirtAvg, vec3(0.02));
  // Yalnızca parlaklık detayı (renk alan dokusundan gelir) — fotoğraftaki renk sapmaları lekelenme yapmasın
  vec3 detail = vec3(dot(mix(dT, gT, green), vec3(0.3333)));
  float dB = texture2D(detailMap, wm / 5.0).r;
  float fade = clamp(1.0 - length(vViewPosition) / 250.0, 0.0, 1.0);
  diffuseColor.rgb *= mix(vec3(0.92 + 0.08 * dB), clamp(detail, 0.0, 2.0) * (0.9 + 0.1 * dB), fade * 0.85);
#endif`,
      );
  };
  ground.customProgramCacheKey = () => 'ground-detail-v6';
  const trees = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const roadFill = detailMaterial(asphalt, { key: 'roadFill', polygonOffset: -5, normalScale: 0.8 });
  roadFill.vertexColors = false;
  roadFill.color.setRGB(0.26, 0.265, 0.26);
  return {
    byKey,
    roadFill,
    ground,
    trees,
    dispose() {
      for (const m of Object.values(byKey)) m.dispose();
      roadFill.dispose();
      ground.dispose();
      trees.dispose();
      for (const t of [atlas, grain, sidewalkTex, pitchTex, detailTex]) t.dispose();
      for (const p of pbrSets) for (const t of [p.map, p.normalMap, p.roughnessMap]) t?.dispose();
      ground.map?.dispose();
    },
  };
}

/** Ağaç türleri: gövde + tepe tek geometri (vertex color). */
export function createTreeGeometries(): THREE.BufferGeometry[] {
  const colorize = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const merge = (parts: THREE.BufferGeometry[]) => {
    const nonIdx = parts.map((p) => (p.index ? p.toNonIndexed() : p));
    let total = 0;
    for (const p of nonIdx) total += p.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let o = 0;
    for (const p of nonIdx) {
      p.computeVertexNormals();
      pos.set(p.attributes.position.array as Float32Array, o * 3);
      nor.set(p.attributes.normal.array as Float32Array, o * 3);
      col.set(p.attributes.color.array as Float32Array, o * 3);
      o += p.attributes.position.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  };
  const trunkC = new THREE.Color(0x6b4f3a);
  const leaf1 = new THREE.Color(0x4f7a35);
  const leaf2 = new THREE.Color(0x2f5a2c);
  const leaf3 = new THREE.Color(0x6a8a3a);
  const round = merge([
    colorize(new THREE.CylinderGeometry(0.14, 0.22, 3, 6).translate(0, 1.5, 0), trunkC),
    colorize(new THREE.IcosahedronGeometry(2.3, 0).scale(1, 0.85, 1).translate(0, 4.4, 0), leaf1),
  ]);
  const cone = merge([
    colorize(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 5).translate(0, 0.6, 0), trunkC),
    colorize(new THREE.ConeGeometry(1.0, 7.5, 7).translate(0, 4.8, 0), leaf2),
  ]);
  const oval = merge([
    colorize(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6).translate(0, 1.1, 0), trunkC),
    colorize(new THREE.IcosahedronGeometry(1.6, 0).scale(1, 2.0, 1).translate(0, 5, 0), leaf3),
  ]);
  return [round, cone, oval];
}
