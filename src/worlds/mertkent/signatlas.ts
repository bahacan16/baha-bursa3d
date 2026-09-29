import * as THREE from 'three';
import type { Builder } from './builder';
import type { SignSpec } from './facade';
import { drawBanner, drawShopSign } from './textures';
import { nightUniform } from '../../env/night';

/**
 * v7 tabela atlası: tüm tabela / pankart / folyo / ekran / hale yüzleri, gerçek boylarıyla (px/m) 2048² (Düşük
 * kalitede 1024²) sayfalara raf yöntemiyle yerleştirilir; sayfa × tür başına TEK malzeme (önceden tabela başına bir
 * doku + malzeme: yüzlerce çizim çağrısı ve 1024 px doku). Üretici tabela yüzlerini geçici kovalara (`sgn:<n>:…`)
 * çizer; `finalize` bu kovaları sayfa malzemesi kovasına taşır ve UV'leri sayfadaki bölgeye dönüştürür.
 *
 * Işık: köşe başına `aux.x` — 0 ışıksız, 1 ışıklı tabela (gece parlak, gündüz sönük), 2 LED ekran (gündüz de
 * parlak). Hale (arkadan aydınlatmalı harflerin duvardaki ışığı) ayrı, katkılı (additive) ve yalnız gece görünür.
 */

type Variant = 'op' | 'al' | 'sd' | 'ha' | 'bn' | 'bm' | 'sc';

interface Region {
  id: number;
  spec: SignSpec;
  /** İstenen en büyük gerçek boy (m) */
  wm: number;
  hm: number;
  W: number;
  H: number;
  x: number;
  y: number;
  page: number;
  /** Opak tür (kenar dolgusu bg rengiyle) */
  opaque: boolean;
}

const GUTTER = 4;

function variantOf(sg: SignSpec): Variant {
  if (sg.side) return 'sd';
  if (sg.halo && (sg.haloPad ?? 0) > 0) return 'ha';
  if (sg.banner) return sg.mesh ? 'bm' : 'bn';
  if (sg.style === 'screen') return 'sc';
  const transparent = !sg.bg || sg.style === 'letters' || sg.shape === 'round' || sg.shape === 'oval';
  return transparent ? 'al' : 'op';
}

/** Doku içeriğini belirleyen alanlar (ışık, yan katman ve gerçek boy hariç; oran 0.1 adımla) */
function regionKey(sg: SignSpec): string {
  return JSON.stringify([
    sg.text,
    sg.lines ?? null,
    sg.bg,
    sg.fg,
    sg.border,
    sg.font,
    sg.bold,
    sg.style,
    Math.round((sg.w / Math.max(0.01, sg.h)) * 10),
    sg.outline ?? null,
    sg.shape ?? null,
    sg.icon ?? null,
    sg.iconC ?? null,
    sg.banner ?? null,
    sg.glyphs?.length ? [sg.glyphs, sg.join ?? null] : null,
    sg.capH != null ? Math.round((sg.capH / Math.max(0.01, sg.h)) * 50) : null,
    sg.align ?? null,
    sg.halo && (sg.haloPad ?? 0) > 0 ? [sg.halo, Math.round(((sg.haloPad ?? 0) / Math.max(0.01, sg.h)) * 50)] : null,
    sg.blocks?.length ? sg.blocks : null,
    sg.mesh ? 1 : null,
  ]);
}

export class SignAtlas {
  private regions = new Map<string, Region>();
  private temps = new Map<string, { region: Region; variant: Variant; lit: number }>();

  constructor(
    private pxPerM = 160,
    private pageSize = 2048,
    private prefix = 'sgnAtlas',
  ) {}

  /** Tabela yüzü kaydı → geçici kova anahtarı (Builder bu anahtara çizer; finalize sayfa kovasına taşır) */
  face(sg: SignSpec): string {
    const rk = regionKey(sg);
    let r = this.regions.get(rk);
    const v = variantOf(sg);
    if (!r) {
      r = {
        id: this.regions.size,
        spec: { ...sg, side: false, lit: false },
        wm: 0,
        hm: 0,
        W: 0,
        H: 0,
        x: 0,
        y: 0,
        page: 0,
        opaque: v === 'op' || v === 'bn' || v === 'sc',
      };
      this.regions.set(rk, r);
    }
    r.wm = Math.max(r.wm, sg.w);
    r.hm = Math.max(r.hm, sg.h);
    const lit = v === 'sc' ? 2 : sg.lit && v !== 'sd' && v !== 'ha' ? 1 : 0;
    const k = `sgn:${r.id}:${v}:${lit}`;
    if (!this.temps.has(k)) this.temps.set(k, { region: r, variant: v, lit });
    return k;
  }

  /** Kayıtlı yüz sayısı (test / hata ayıklama) */
  get size(): number {
    return this.regions.size;
  }

  /**
   * Sayfaları yerleştirir, çizer, malzemeleri `mats`e ekler ve geçici kovaları sayfa kovalarına taşır. Builder'daki
   * kullanılmayan kayıtlar atlanır.
   */
  finalize(b: Builder, mats: Record<string, THREE.Material>): { pages: number; regions: number } {
    const used = new Set(b.keys());
    const live = [...this.temps.entries()].filter(([k]) => used.has(k));
    if (!live.length) return { pages: 0, regions: 0 };
    const regs = [...new Set(live.map(([, t]) => t.region))];
    const S = this.pageSize;
    const MAX = Math.min(1024, S - 2 * GUTTER);
    for (const r of regs) {
      let W = Math.max(8, r.wm * this.pxPerM);
      let H = Math.max(8, r.hm * this.pxPerM);
      const sc = Math.min(1, MAX / Math.max(W, H));
      W *= sc;
      H *= sc;
      // Küçük tabelalar okunabilsin: kısa kenar en az 24 px (oran korunarak, uzun kenar en çok MAX)
      const up = Math.min(Math.max(1, 24 / Math.min(W, H)), MAX / Math.max(W, H));
      r.W = Math.max(4, Math.round(W * up));
      r.H = Math.max(4, Math.round(H * up));
    }
    // Raf yerleştirme (yüksekliğe göre)
    const order = regs.slice().sort((p, q) => q.H - p.H || q.W - p.W || p.id - q.id);
    const pageH: number[] = [];
    let page = 0;
    let x = GUTTER;
    let y = GUTTER;
    let shelf = 0;
    for (const r of order) {
      if (x + r.W + GUTTER > S) {
        x = GUTTER;
        y += shelf + 2 * GUTTER;
        shelf = 0;
      }
      if (y + r.H + GUTTER > S) {
        pageH[page] = S;
        page++;
        x = GUTTER;
        y = GUTTER;
        shelf = 0;
      }
      r.x = x;
      r.y = y;
      r.page = page;
      x += r.W + 2 * GUTTER;
      shelf = Math.max(shelf, r.H);
      pageH[page] = Math.max(pageH[page] ?? 0, y + r.H + GUTTER);
    }
    // Sayfa yükseklikleri: 2'nin kuvveti (son sayfa kısa olabilir)
    const PH = pageH.map((h) => Math.min(S, 1 << Math.ceil(Math.log2(Math.max(64, h)))));
    const hasDoc = typeof document !== 'undefined';
    const maps: (THREE.Texture | null)[] = PH.map((h, p) => {
      if (!hasDoc) return null;
      const cv = document.createElement('canvas');
      cv.width = S;
      cv.height = h;
      const g = cv.getContext('2d')!;
      g.clearRect(0, 0, S, h);
      for (const r of regs) {
        if (r.page !== p) continue;
        const sp = r.spec;
        if (r.opaque) {
          // Kenar dolgusu (mip seviyelerinde komşu bölge sızmasın)
          g.fillStyle = sp.bg ?? (sp.banner ? '#d21f26' : '#000000');
          g.fillRect(r.x - GUTTER, r.y - GUTTER, r.W + 2 * GUTTER, r.H + 2 * GUTTER);
        }
        g.save();
        g.translate(r.x, r.y);
        g.beginPath();
        g.rect(0, 0, r.W, r.H);
        g.clip();
        if (sp.banner)
          drawBanner(g, r.W, r.H, {
            style: sp.banner,
            bg: sp.bg,
            fg: sp.fg,
            text: sp.text,
            w: sp.w,
            h: sp.h,
            lines: sp.lines ?? null,
            blocks: sp.blocks ?? null,
            mesh: sp.mesh ?? null,
          });
        else drawShopSign(g, r.W, r.H, { ...sp, w: r.wm, h: r.hm });
        g.restore();
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    });
    // Malzemeler (sayfa × tür)
    const matOf = (p: number, v: Variant): string => {
      const key = `${this.prefix}${p}_${v}`;
      if (mats[key]) return key;
      const map = maps[p];
      if (!map) {
        mats[key] = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.6 });
        return key;
      }
      if (v === 'ha') {
        const m = new THREE.MeshBasicMaterial({
          map,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        m.userData.noCast = true;
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uNight = nightUniform;
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uNight;')
            .replace('#include <dithering_fragment>', 'gl_FragColor.rgb *= uNight;\n#include <dithering_fragment>');
        };
        m.customProgramCacheKey = () => 'mk-sign-halo-v1';
        mats[key] = m;
        return key;
      }
      const alpha = v === 'al' || v === 'sd' || v === 'bm';
      const m = new THREE.MeshStandardMaterial({
        map,
        color: v === 'sd' ? 0x8c8c8c : 0xffffff,
        transparent: alpha,
        alphaTest: alpha ? (v === 'bm' ? 0.3 : 0.35) : 0,
        roughness: v === 'bn' || v === 'bm' ? 0.85 : v === 'sc' ? 0.3 : 0.5,
        side: v === 'bn' || v === 'bm' ? THREE.DoubleSide : THREE.FrontSide,
        emissive: v === 'sd' || v === 'bn' || v === 'bm' ? 0x000000 : 0xffffff,
        emissiveMap: v === 'sd' || v === 'bn' || v === 'bm' ? null : map,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      if (v !== 'sd' && v !== 'bn' && v !== 'bm') {
        // Köşe başına ışık düzeyi (aux.x): 0 sönük, 1 gece ışıklı tabela, 2 LED ekran
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uNight = nightUniform;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec4 aux;\nvarying float vLit;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aux.x;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLit;')
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
float lf = vLit < 0.5 ? 0.0 : (vLit < 1.5 ? mix(0.08, 0.9, uNight) : mix(0.85, 1.25, uNight));
totalEmissiveRadiance *= lf;`,
            );
        };
        m.customProgramCacheKey = () => `mk-sign-atlas-v1-${alpha ? 'a' : 'o'}`;
      }
      mats[key] = m;
      return key;
    };
    for (const [k, t] of live) {
      const r = t.region;
      const h = PH[r.page];
      const to = matOf(r.page, t.variant);
      const x0 = (r.x + 0.5) / S;
      const sx = (r.W - 1) / S;
      const y0 = r.y + 0.5;
      const sy = r.H - 1;
      b.moveBucket(
        k,
        to,
        (u, v) => [x0 + Math.max(0, Math.min(1, u)) * sx, 1 - (y0 + (1 - Math.max(0, Math.min(1, v))) * sy) / h],
        [t.lit, 0, 0, 0],
      );
    }
    return { pages: PH.length, regions: regs.length };
  }
}
