import * as THREE from 'three';
import { ATLAS_GRID, SHOP_BASE, SHOP_H, TILE_H, TILE_W } from './chunks';
import { nightUniform } from '../../env/night';

/**
 * Prosedürel cephe doku atlası (canvas). Türk apartman tonları: krem, bej, açık somon, kırık beyaz, açık gri, toprak.
 * Her karo 5 m × 3.1 m duvarı temsil eder (2 pencere aralığı, 1 kat).
 */
interface Variant {
  wall: string;
  frame: string;
  glass: string;
  balcony: boolean;
  shutter?: string;
  band?: string;
  wide?: boolean;
}

const VARIANTS: Variant[] = [
  { wall: '#eadfc8', frame: '#ffffff', glass: '#3b4a57', balcony: true },
  { wall: '#dcc6a0', frame: '#f4f4f0', glass: '#34414c', balcony: false, band: '#c8b089' },
  { wall: '#e8b99d', frame: '#ffffff', glass: '#394652', balcony: true },
  { wall: '#f1eee6', frame: '#3a3d40', glass: '#2e3a44', balcony: false, wide: true },
  { wall: '#c9c7c2', frame: '#ffffff', glass: '#36434e', balcony: true },
  { wall: '#b98d6b', frame: '#f2efe8', glass: '#303b45', balcony: false, band: '#a37a5a' },
  { wall: '#efe3bf', frame: '#ffffff', glass: '#3d4b58', balcony: true, shutter: '#8c5a3c' },
  { wall: '#d9cfc0', frame: '#4a4d50', glass: '#2c3843', balcony: true, wide: true },
  { wall: '#f0d7c2', frame: '#ffffff', glass: '#3a4753', balcony: false },
  { wall: '#e3e0d6', frame: '#ffffff', glass: '#35424d', balcony: true, band: '#c9c3b5' },
  { wall: '#caa98a', frame: '#f6f3ea', glass: '#333f49', balcony: true },
  { wall: '#d8d2c6', frame: '#ffffff', glass: '#3b4750', balcony: false },
];

const SHOPS = [
  { sign: '#b8322a', frame: '#2d2f31' },
  { sign: '#1f5e8c', frame: '#dedcd6' },
  { sign: '#2f7a45', frame: '#2d2f31' },
  { sign: '#c9902c', frame: '#3a3a3a' },
];

function noise(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  a: number,
  seed: number,
) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < (w * h) / 60; i++) {
    const px = x + rnd() * w;
    const py = y + rnd() * h;
    ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a * rnd()})` : `rgba(255,255,255,${a * rnd()})`;
    ctx.fillRect(px, py, 2, 2);
  }
}

function drawResidential(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  v: Variant,
  i: number,
) {
  const mx = s / TILE_W; // px / m (yatay)
  const my = s / TILE_H; // px / m (dikey)
  // KARO: y = üst (canvas), dokuda flipY ile alt = kat tabanı.
  ctx.fillStyle = v.wall;
  ctx.fillRect(x, y, s, s);
  noise(ctx, x, y, s, s, 0.05, 1000 + i * 7);
  // Kat döşeme bandı
  ctx.fillStyle = v.band ?? 'rgba(0,0,0,0.07)';
  ctx.fillRect(x, y + s - 0.22 * my, s, 0.22 * my);
  if (i === 11) {
    // Sade karo: tek küçük pencere
    const wx = x + 1.9 * mx;
    const wy = y + s - 2.2 * my;
    ctx.fillStyle = v.frame;
    ctx.fillRect(wx - 4, wy - 4, 1.2 * mx + 8, 1.0 * my + 8);
    ctx.fillStyle = v.glass;
    ctx.fillRect(wx, wy, 1.2 * mx, 1.0 * my);
    return;
  }
  for (let k = 0; k < 2; k++) {
    const bayX = x + k * 2.5 * mx;
    const winW = (v.wide ? 1.7 : 1.3) * mx;
    const winH = (k === 1 && v.balcony ? 2.25 : 1.45) * my;
    const sill = (k === 1 && v.balcony ? 0.2 : 0.9) * my;
    const wx = bayX + (2.5 * mx - winW) / 2;
    const wy = y + s - sill - winH;
    if (k === 1 && v.balcony) {
      // Balkon: koyu girinti + korkuluk
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(bayX + 0.1 * mx, y + 0.15 * my, 2.3 * mx, s - 0.35 * my);
    }
    ctx.fillStyle = v.frame;
    ctx.fillRect(wx - 5, wy - 5, winW + 10, winH + 10);
    const g = ctx.createLinearGradient(wx, wy, wx + winW, wy + winH);
    g.addColorStop(0, v.glass);
    g.addColorStop(0.55, '#6f8596');
    g.addColorStop(1, v.glass);
    ctx.fillStyle = g;
    ctx.fillRect(wx, wy, winW, winH);
    // kayıt/orta kayıt
    ctx.fillStyle = v.frame;
    ctx.fillRect(wx + winW / 2 - 3, wy, 6, winH);
    if (k === 0 || !v.balcony) ctx.fillRect(wx, wy + winH * 0.3, winW, 4);
    if (v.shutter && !(k === 1 && v.balcony)) {
      ctx.fillStyle = v.shutter;
      ctx.fillRect(wx - 0.35 * mx, wy - 4, 0.3 * mx, winH + 8);
      ctx.fillRect(wx + winW + 0.05 * mx, wy - 4, 0.3 * mx, winH + 8);
    }
    if (k === 1 && v.balcony) {
      const ry = y + s - 1.2 * my;
      ctx.fillStyle = v.frame === '#ffffff' ? '#e9e9e6' : v.frame;
      ctx.fillRect(bayX + 0.1 * mx, ry, 2.3 * mx, 6);
      ctx.fillStyle = 'rgba(40,40,40,0.55)';
      for (let b = 0; b < 12; b++) ctx.fillRect(bayX + 0.15 * mx + b * 0.19 * mx, ry, 3, 1.0 * my);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(bayX + 0.1 * mx, ry + 1.0 * my - 8, 2.3 * mx, 8);
    } else {
      // pencere denizliği
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(wx - 8, wy + winH + 5, winW + 16, 6);
    }
  }
}

function drawShop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, i: number) {
  const sh = SHOPS[i % SHOPS.length];
  const mx = s / TILE_W;
  const my = s / SHOP_H;
  ctx.fillStyle = '#d8d3c8';
  ctx.fillRect(x, y, s, s);
  noise(ctx, x, y, s, s, 0.06, 5000 + i * 13);
  // tabela bandı
  ctx.fillStyle = sh.sign;
  ctx.fillRect(x, y + 0.25 * my, s, 0.75 * my);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x + 0.6 * mx, y + 0.5 * my, 1.6 * mx, 0.25 * my);
  ctx.fillRect(x + 2.6 * mx, y + 0.5 * my, 1.2 * mx, 0.25 * my);
  // vitrin
  ctx.fillStyle = sh.frame;
  ctx.fillRect(x + 0.15 * mx, y + 1.1 * my, s - 0.3 * mx, s - 1.1 * my - 0.1 * my);
  const g = ctx.createLinearGradient(x, y + 1.2 * my, x + s, y + s);
  g.addColorStop(0, '#1f2a33');
  g.addColorStop(0.5, '#5d7282');
  g.addColorStop(1, '#27323b');
  ctx.fillStyle = g;
  ctx.fillRect(x + 0.3 * mx, y + 1.25 * my, s - 0.6 * mx, s - 1.45 * my);
  ctx.fillStyle = sh.frame;
  ctx.fillRect(x + s / 2 - 4, y + 1.25 * my, 8, s - 1.45 * my);
  // kapı
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 3.3 * mx, y + 1.6 * my, 1.1 * mx, s - 1.7 * my);
}

export function createFacadeAtlas(size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = size / ATLAS_GRID;
  for (let i = 0; i < ATLAS_GRID * ATLAS_GRID; i++) {
    const col = i % ATLAS_GRID;
    const row = Math.floor(i / ATLAS_GRID);
    // flipY: doku satırı 0 canvas'ın en altında
    const x = col * s;
    const y = (ATLAS_GRID - 1 - row) * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, s, s);
    ctx.clip();
    if (i >= SHOP_BASE) drawShop(ctx, x, y, s, i - SHOP_BASE);
    else drawResidential(ctx, x, y, s, VARIANTS[i], i);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * Cephe malzemesi: uv metre cinsinden; atlas karosu shader'da `fract` ile tekrarlanır.
 * Mip seçimi için textureGrad sürekli türevlerle çağrılır (karo sınırında dikiş olmasın).
 */
/** Gökyüzü yansıması renkleri (cam için), Game her zaman değişiminde günceller. */
export const facadeSky = {
  top: { value: new THREE.Color(0x6f9bd1) },
  horizon: { value: new THREE.Color(0xd6e2ea) },
  ground: { value: new THREE.Color(0x5a5850) },
};

export function createFacadeMaterial(
  atlas: THREE.Texture,
  plaster?: { map: THREE.Texture; normalMap: THREE.Texture | null; avg: { value: THREE.Color } },
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: atlas,
    roughness: 0.85,
    metalness: 0,
    vertexColors: true,
  });
  if (plaster?.normalMap) {
    mat.normalMap = plaster.normalMap;
    mat.normalScale.setScalar(0.45);
  }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.uniforms.uPlaster = { value: plaster?.map ?? null };
    sh.uniforms.uPlasterAvg = plaster?.avg ?? { value: new THREE.Color(0.5, 0.5, 0.5) };
    sh.uniforms.uSkyTop = facadeSky.top;
    sh.uniforms.uSkyHorizon = facadeSky.horizon;
    sh.uniforms.uSkyGround = facadeSky.ground;
    if (plaster) sh.defines = { ...(sh.defines ?? {}), USE_PLASTER: '' };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacade = facade;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vFacade;\nuniform float uNight;\nuniform sampler2D uPlaster;\nuniform vec3 uPlasterAvg;\nuniform vec3 uSkyTop;\nuniform vec3 uSkyHorizon;\nuniform vec3 uSkyGround;\nvec4 facadeTexel = vec4(0.0);\nvec3 facadeCell = vec3(0.0);\nfloat facadeGlass = 0.0;',
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
#ifdef USE_MAP
{
  const float G = ${ATLAS_GRID.toFixed(1)};
  vec2 m = vMapUv;
  float variant = floor(vFacade.x + 0.5);
  float shop = floor(vFacade.y + 0.5);
  float wallTop = vFacade.z;
  float parapet = vFacade.w;
  float tile = variant;
  vec2 cell = vec2(${TILE_W.toFixed(2)}, ${TILE_H.toFixed(2)});
  float yOff = 0.0;
  if (shop >= 0.0) {
    if (m.y < ${SHOP_H.toFixed(2)}) { tile = shop; cell.y = ${SHOP_H.toFixed(2)}; }
    else yOff = ${(SHOP_H - TILE_H).toFixed(2)};
  }
  vec2 q = (m - vec2(0.0, yOff)) / cell;
  vec2 f = fract(q);
  // Parapet / çatı bandı ve bina üstündeki kısmi kat: sade duvar
  float band = max(parapet, 0.35);
  float floorTop = (floor(q.y) + 1.0) * cell.y + yOff;
  if (m.y > wallTop - band || floorTop > wallTop - band + 0.4) {
    f = vec2(0.02, 0.6);
  }
  vec2 origin = vec2(mod(tile, G), floor(tile / G));
  const float pad = 0.004;
  vec2 auv = (origin + pad + f * (1.0 - 2.0 * pad)) / G;
  vec2 gx = dFdx(q) / G;
  vec2 gy = dFdy(q) / G;
  vec4 sampledDiffuseColor = textureGrad(map, auv, gx, gy);
  facadeTexel = sampledDiffuseColor;
  {
    vec3 t = sampledDiffuseColor.rgb;
    float lum = dot(t, vec3(0.3, 0.59, 0.11));
    facadeGlass = step(lum, 0.42) * step(t.r + 0.02, t.b);
  }
  {
    // Perdeler: bazı pencerelerde açık renk perde (camın alt kısmı), bazılarında jaluzi
    float ch = fract(sin(dot(vec3(floor(q.x * 2.0), floor(q.y), variant + floor(m.x / 40.0)), vec3(7.13, 157.1, 113.7))) * 43758.5);
    vec3 curtain = ch < 0.33 ? vec3(0.78, 0.72, 0.62) : ch < 0.5 ? vec3(0.62, 0.64, 0.66) : sampledDiffuseColor.rgb;
    float cmask = facadeGlass * step(ch, 0.5) * (0.55 + 0.25 * fract(ch * 17.0));
    sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, curtain * 0.8, cmask);
  }
#ifdef USE_PLASTER
  // Gerçek sıva dokusu (yalnızca parlaklık) — cam dışı pikseller
  float pl = dot(texture2D(uPlaster, m / 2.0).rgb / max(uPlasterAvg, vec3(0.02)), vec3(0.3333));
  sampledDiffuseColor.rgb *= mix(1.0, clamp(pl, 0.6, 1.4), 0.7 * (1.0 - facadeGlass));
#endif
  // Zemine yakın kirlenme ve bina bazında hafif ton farkı
  float grime = 0.82 + 0.18 * smoothstep(0.0, 1.4, m.y);
  float bh = fract(sin(dot(vec2(variant, floor(vFacade.z * 3.0)), vec2(12.9898, 78.233))) * 43758.5453);
  sampledDiffuseColor.rgb *= mix(1.0, grime, 1.0 - facadeGlass) * (0.94 + 0.12 * bh);
  diffuseColor *= sampledDiffuseColor;
  // Pencere kimliği: kat + bölme (+ bina varyantı)
  facadeCell = vec3(floor(q.x * 2.0), floor(q.y), variant + shop * 7.0);
}
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, facadeGlass);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
{
  // Cam: gökyüzü yansıması (Fresnel). Görünüm uzayında dünya "yukarı" vektörü.
  vec3 V = normalize(vViewPosition);
  vec3 N = normalize(normal);
  vec3 R = reflect(-V, N);
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float ry = dot(R, up);
  vec3 sky = ry > 0.0 ? mix(uSkyHorizon, uSkyTop, pow(ry, 0.6)) : mix(uSkyHorizon, uSkyGround, pow(-ry, 0.5));
  // Pencere başına farklılık: perde/jaluzi rengi, yansıma gücü
  float wh = fract(sin(dot(facadeCell + floor(vMapUv.x / 40.0), vec3(39.34, 11.13, 83.17))) * 24634.63);
  float fres = (0.18 + 0.7 * pow(1.0 - max(dot(N, V), 0.0), 4.0)) * (0.55 + 0.9 * wh);
  totalEmissiveRadiance += sky * fres * facadeGlass * (1.0 - uNight * 0.85) * 0.5;
}
if (uNight > 0.01) {
  vec3 t = facadeTexel.rgb;
  float lum = dot(t, vec3(0.3, 0.59, 0.11));
  // Cam: koyu ve mavimsi pikseller
  float glass = step(lum, 0.42) * step(t.r + 0.02, t.b);
  float h = fract(sin(dot(facadeCell + floor(vMapUv.x / 40.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float lit = step(h, 0.36);
  vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(0.75, 0.82, 1.0), step(0.82, fract(h * 7.0))) * (0.5 + 0.5 * fract(h * 13.0));
  totalEmissiveRadiance += warm * glass * lit * uNight * 0.55;
}`,
      );
  };
  mat.customProgramCacheKey = () => `facade-v5${plaster ? '-p' : ''}`;
  return mat;
}
