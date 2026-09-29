import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { REAL_SPECS } from '../../src/worlds/mertkent/realtex';
import { buildStreetPlan, layerKey } from '../../src/worlds/mertkent/street';
import { Builder } from '../../src/worlds/mertkent/builder';

type Buckets = { buckets: Map<string, { pos: number[]; nor: number[] }> };

const MAN = 'public/textures/real/manifest.json';

describe('gerçek zemin dokuları (scripts/real-textures.mjs)', () => {
  const man = JSON.parse(readFileSync(MAN, 'utf8')) as {
    sets: Record<
      string,
      { size: [number, number]; module?: [number, number]; bond?: string; heightRangeMM?: [number, number] }
    >;
  };

  it('paralaks derinliği yükseklik aralığıyla aynı', () => {
    for (const s of Object.values(REAL_SPECS)) {
      if (!s.pom) continue;
      const r = man.sets[s.dir].heightRangeMM;
      expect(r, s.dir).toBeTruthy();
      expect(s.pom).toBeCloseTo((r![1] - r![0]) / 1000, 6);
    }
  });

  it('realtex.ts boyutları manifest ile aynı, dosyalar mevcut', () => {
    for (const [key, s] of Object.entries(REAL_SPECS)) {
      const m = man.sets[s.dir];
      expect(m, `${key} → ${s.dir}`).toBeTruthy();
      expect(m.size[0]).toBeCloseTo(s.size[0], 3);
      expect(m.size[1]).toBeCloseTo(s.size[1], 3);
      for (const f of ['albedo', 'rh'])
        for (const r of ['', '-1k'])
          expect(existsSync(`public/textures/real/${s.dir}/${f}${r}.jpg`), `${s.dir}/${f}${r}`).toBe(true);
    }
  });

  it('desenli dokular modülün tam katı (dikişsiz döşeme)', () => {
    for (const set of Object.values(man.sets)) {
      if (!set.module) continue;
      const [mu, mv] = set.module;
      // Şaşırtmalı dizi: v yönünde iki sıra (2·mv) tekrar eder; ızgara (stack) dizide bir sıra
      const ku = (set.size[0] * 1000) / mu;
      const kv = (set.size[1] * 1000) / ((set.bond === 'stack' ? 1 : 2) * mv);
      expect(Math.abs(ku - Math.round(ku))).toBeLessThan(1e-6);
      expect(Math.abs(kv - Math.round(kv))).toBeLessThan(1e-6);
    }
  });

  it('kaldırım katmanı malzemesi baş ifadeden (komşu bant anılması anahtarı değiştirmez)', () => {
    const cases: [string, string][] = [
      [
        'gri beton kilit taşı 10×20, boyuna: bordürden 0.40 gri + 0.32 sarı kılavuz + 0.65 gri',
        'spPaverGrey',
      ],
      ['gri beton kilit taşı 10×20 (köşede sarı kılavuz kıvrılarak devam eder)', 'spPaverGrey'],
      ['sarı hissedilebilir kılavuz karo (çizgili), ıslak ≈#cfa577', 'tactile'],
      ['kiremit-kırmızı beton kilit taşı 10×20 (bordür dibinden)', 'spPaverRed'],
      ['krem/bej beton kenar taşı (çime karşı)', 'edging'],
      ['gri beton ayırıcı kenar taşı şeridi (koyu derz çizgisi, kotla aynı)', 'curb'],
      ['çim (orta refüj), içinde kazıklı genç ağaç', 'lawn'],
      ['ağaç şeridi: çıplak toprak, yer yer seyrek ot', 'spGravel'],
    ];
    for (const [m, k] of cases) expect(layerKey(m), m).toBe(k);
  });

  it('boyalı bordür: yan yüz yola bakar ve bordürün önünde, üst şerit yukarı bakar', () => {
    for (const side of ['left', 'right'] as const) {
      const b = new Builder();
      const plan = {
        sidewalks: [
          {
            id: 'test',
            pts: [
              [0, 10],
              [0, -30],
            ],
            w: 1.52,
            side,
            kerbH: 0.15,
            bike: 1.1,
            kerbPaint: 'white',
            layers: [{ w: 1.37, material: 'gri beton kilit taşı 10×20', h: 0.15 }],
          },
        ],
      };
      buildStreetPlan(
        b,
        plan as never,
        () => 0,
        () => 0,
      );
      const k = (b as unknown as Buckets).buckets.get('kerbPaint');
      expect(k, side).toBeTruthy();
      // Hat kuzeye (t = (0, −1)); kaldırım yönü sideNormal: left → −x, right → +x; yol ters tarafta
      const inward = side === 'left' ? -1 : 1;
      let walls = 0;
      let tops = 0;
      for (let i = 0; i < k!.nor.length; i += 3) {
        const [nx, ny] = [k!.nor[i], k!.nor[i + 1]];
        if (ny > 0.9) tops++;
        else {
          expect(nx * inward, `${side} yan yüz normali`).toBeLessThan(-0.9);
          expect(k!.pos[i] * inward, `${side} yan yüz konumu`).toBeLessThan(0);
          walls++;
        }
      }
      expect(walls).toBeGreaterThan(0);
      expect(tops).toBeGreaterThan(0);
    }
  });
});
