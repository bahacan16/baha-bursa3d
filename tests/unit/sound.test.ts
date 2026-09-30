import { describe, expect, it } from 'vitest';
import {
  FOOT_SURFACES,
  aerialSurface,
  footProfile,
  osmAreaSurface,
  pickBank,
  planSurface,
} from '../../src/env/sound/surfaces';
import { BuildingIndex, nearestOnPolyline } from '../../src/env/sound/geometry';
import { analyzeAcoustics, makeImpulse } from '../../src/env/sound/acoustics';
import { chainRails, railHeadway } from '../../src/env/sound/rail';
import { roadBedSpl, trafficDensity, TrafficSound } from '../../src/env/sound/traffic';
import { birdActivity, childrenActivity } from '../../src/env/sound/nature';
import type { SoundBuilding } from '../../src/env/sound/types';
import { OsmSoundScene } from '../../src/env/sound/osmscene';
import { parseOsm, type OsmWorldData } from '../../src/worlds/osm/parse';
import { SITE_PLAN, STREET_PLAN } from '../../src/worlds/measured/siteplan';
import {
  detectEvents,
  makeLoop,
  packSprite,
  parseFreesoundPack,
  parseFreesoundPage,
  parseLicense,
} from '../../scripts/sounds-lib.mjs';

describe('zemin → ayak sesi eşlemesi', () => {
  it('her zeminin profili ve bankası var', () => {
    for (const s of FOOT_SURFACES) {
      const p = footProfile(s);
      expect(p.banks.length, s).toBeGreaterThan(0);
      expect(p.banks.every((b) => b.startsWith('step_'))).toBe(true);
    }
  });

  it('eksik bankada akustik komşuya düşer', () => {
    const has = (slots: string[]) => (s: string) => slots.includes(s);
    expect(pickBank('pavers', has(['step_pavers', 'step_concrete']))).toBe('step_pavers');
    expect(pickBank('pavers', has(['step_concrete']))).toBe('step_concrete');
    expect(pickBank('asphalt', has(['step_pavers']))).toBe('step_pavers');
    expect(pickBank('grass', has(['step_soil']))).toBe('step_soil');
    expect(pickBank('metal', has(['step_concrete']))).toBe('step_concrete');
    expect(pickBank('gravel', has([]))).toBeNull();
    // Rögar kapağı: kayıt yoksa da metal çınlaması eklenir
    expect(footProfile('metal').ring).toBeGreaterThan(0);
    // Kauçuk oyun alanı boğuk ve kısık
    expect(footProfile('rubber').lowpass).toBeGreaterThan(0);
    expect(footProfile('rubber').gain).toBeLessThan(0);
  });

  it('ölçülmüş site/park planı alan türleri', () => {
    expect(planSurface('lawn')).toBe('grass');
    expect(planSurface('paving', 'gri beton kilit taşı 10x20')).toBe('pavers');
    expect(planSurface('paving', 'beton ped')).toBe('concrete');
    expect(planSurface('deck', 'krem traverten plak')).toBe('stone');
    expect(planSurface('court')).toBe('concrete');
    expect(planSurface('playground', 'koyu mor-kahve kauçuk karo')).toBe('rubber');
    expect(planSurface('gravel', 'bej-gri stabilize ince çakıl')).toBe('gravel');
    expect(planSurface('bed', 'malç')).toBe('soil');
    expect(planSurface('pool')).toBe('water');
    expect(planSurface('deck', 'ahşap deck')).toBe('wood');
    expect(planSurface('unknown-kind')).toBeNull();
  });

  it('OSM alan türleri', () => {
    expect(osmAreaSurface('park')).toBe('grass');
    expect(osmAreaSurface('pitch')).toBe('grass');
    expect(osmAreaSurface('pedestrian')).toBe('pavers');
    expect(osmAreaSurface('construction')).toBe('gravel');
    expect(osmAreaSurface('parking')).toBe('hard');
    expect(osmAreaSurface('residential')).toBe('hard');
    expect(osmAreaSurface('xyz')).toBeNull();
  });

  it('hava fotoğrafı rengi', () => {
    expect(aerialSurface(70, 110, 55)).toBe('grass');
    expect(aerialSurface(62, 64, 66)).toBe('asphalt');
    expect(aerialSurface(170, 165, 158)).toBe('pavers');
    expect(aerialSurface(150, 115, 80)).toBe('soil');
    // Sert olduğu bilinen alanda toprak yerine kilit taşı/beton
    expect(aerialSurface(150, 115, 80, true)).toBe('pavers');
  });
});

describe('dünya zemin sorgusu (OsmSoundScene.surfaceAt)', () => {
  const empty = (): OsmWorldData => ({
    center: { lat: 40.218, lon: 28.907 },
    centerSource: 'fixture',
    half: 1200,
    buildings: [],
    roads: [],
    rails: [],
    areas: [],
    barriers: [],
    trees: [],
    treeRows: [],
    pois: [],
    crossings: [],
    lamps: [],
    shops: [],
    benches: [],
    shelters: [],
  });

  it('öncelik: yol/kaldırım/balast → OSM alanı → varsayılan', () => {
    const d = empty();
    d.areas.push({
      id: 'a1',
      kind: 'park',
      outer: [
        [0, 0],
        [50, 0],
        [50, 50],
        [0, 50],
      ],
      holes: [],
    });
    d.areas.push({
      id: 'a2',
      kind: 'playground',
      outer: [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
      ],
      holes: [],
    });
    d.buildings.push({
      id: 'w1',
      outer: [
        [100, 100],
        [120, 100],
        [120, 120],
        [100, 120],
      ],
      holes: [],
      minHeight: 0,
      height: 20,
      wallTop: 20,
      roofShape: 'flat',
      roofHeight: 0,
      kind: 'mosque',
      isPart: false,
      levels: 2,
      name: 'Cami',
    });
    const s = new OsmSoundScene(d, {
      real: false,
      paved: (x) => (x < -10 ? 'road' : x < -5 ? 'sidewalk' : null),
      ballast: (_x, z) => z > 200,
    });
    expect(s.surfaceAt(-20, 5)).toBe('asphalt');
    expect(s.surfaceAt(-7, 5)).toBe('pavers');
    expect(s.surfaceAt(5, 300)).toBe('gravel');
    expect(s.surfaceAt(30, 30)).toBe('grass');
    // Küçük alan (oyun alanı) büyük alanın (park) önüne geçer
    expect(s.surfaceAt(15, 15)).toBe('rubber');
    expect(s.surfaceAt(500, -500)).toBe('grass');
    expect(s.mosques.map((m) => m.name)).toEqual(['Cami']);
    expect(s.places.some((p) => p.kind === 'playground')).toBe(true);
  });

  it('building:part’lı cami de ezan kaynağı olur (ana hat bina listesinde yok)', () => {
    const sq = (x: number, z: number, s: number) => [x, z, x + s, z, x + s, z + s, x, z + s, x, z];
    const d = parseOsm({
      version: 1,
      center: { lat: 40.218, lon: 28.907 },
      centerSource: 'test',
      half: 1200,
      nodes: [{ i: 1, x: 500, z: 0, t: { amenity: 'place_of_worship', name: 'Yeni Mescit' } }],
      ways: [
        {
          i: 10,
          p: sq(200, 140, 30),
          t: { building: 'mosque', amenity: 'place_of_worship', name: 'Test Cami' },
        },
        { i: 11, p: sq(205, 145, 10), t: { 'building:part': 'yes', height: '9' } },
        { i: 12, p: sq(-50, -50, 10), t: { amenity: 'place_of_worship', building: 'yes', name: 'Cemevi' } },
      ],
      rels: [],
    });
    expect(d.buildings.some((b) => b.kind === 'mosque' && !b.isPart)).toBe(false);
    const s = new OsmSoundScene(d, { real: false });
    expect(s.mosques.map((m) => m.name).sort()).toEqual(['Test Cami', 'Yeni Mescit']);
    const m = s.mosques.find((x) => x.name === 'Test Cami')!;
    expect(m.x).toBeCloseTo(215, 3);
    expect(m.z).toBeCloseTo(155, 3);
  });

  it('gerçek veride ölçülmüş planlar: rögar metal, saha beton', () => {
    const s = new OsmSoundScene({ ...empty(), centerSource: 'osm:502. Sokak' }, { real: true });
    const mh = STREET_PLAN.street?.find((p) => p.kind === 'manhole');
    expect(mh).toBeDefined();
    expect(s.surfaceAt(mh!.x, mh!.z)).toBe('metal');
    const court = SITE_PLAN.areas?.find((a) => a.kind === 'court');
    if (court) {
      const cx = court.poly.reduce((a, p) => a + p[0], 0) / court.poly.length;
      const cz = court.poly.reduce((a, p) => a + p[1], 0) / court.poly.length;
      expect(s.surfaceAt(cx, cz)).toBe('concrete');
    }
    // Plan ağaçları sese eklenir (serçe/rüzgâr)
    expect(s.trees.length).toBeGreaterThan(100);
  });
});

/** İki sıra 7 katlı blok arasında 16 m genişliğinde doğu–batı sokağı. */
function canyon(): SoundBuilding[] {
  const b: SoundBuilding[] = [];
  for (let x = -100; x < 100; x += 25) {
    b.push({
      ring: [
        [x, -30],
        [x + 22, -30],
        [x + 22, -8],
        [x, -8],
      ],
      base: 0,
      top: 22,
    });
    b.push({
      ring: [
        [x, 8],
        [x + 22, 8],
        [x + 22, 30],
        [x, 30],
      ],
      base: 0,
      top: 22,
    });
  }
  return b;
}

describe('kentsel akustik ve örtme', () => {
  it('sokak kanyonu / açık alan sınıflaması', () => {
    const idx = new BuildingIndex(canyon());
    const a = analyzeAcoustics(idx, 0, 1.7, 0);
    expect(a.kind).toBe('canyon');
    expect(a.width).toBeGreaterThan(14);
    expect(a.width).toBeLessThan(18);
    expect(a.rt60).toBeGreaterThan(0.8);
    const open = analyzeAcoustics(new BuildingIndex([]), 0, 1.7, 0);
    expect(open.kind).toBe('open');
    const far = analyzeAcoustics(idx, 0, 1.7, 400);
    expect(far.kind).toBe('open');
  });

  it('avlu: her yönde bina', () => {
    const b: SoundBuilding[] = [
      {
        ring: [
          [-30, -30],
          [30, -30],
          [30, -20],
          [-30, -20],
        ],
        base: 0,
        top: 20,
      },
      {
        ring: [
          [-30, 20],
          [30, 20],
          [30, 30],
          [-30, 30],
        ],
        base: 0,
        top: 20,
      },
      {
        ring: [
          [-30, -20],
          [-20, -20],
          [-20, 20],
          [-30, 20],
        ],
        base: 0,
        top: 20,
      },
      {
        ring: [
          [20, -20],
          [30, -20],
          [30, 20],
          [20, 20],
        ],
        base: 0,
        top: 20,
      },
    ];
    expect(analyzeAcoustics(new BuildingIndex(b), 0, 1.7, 0).kind).toBe('courtyard');
  });

  it('bina arkası örtme, yüksek kaynak (minare) örtülmez', () => {
    const idx = new BuildingIndex(canyon());
    // Sokaktan kuzeydeki blokların arkasına
    expect(idx.occlusion(0, 1.7, 0, 0, 1.5, -60)).toBeGreaterThanOrEqual(1);
    // Sokak boyunca açık
    expect(idx.occlusion(0, 1.7, 0, 90, 1.5, 0)).toBe(0);
    // 22 m cephenin hemen arkasında 60 m yükseklikteki kaynak (minare şerefesi) görülür; alçakta olsa örtülürdü
    expect(idx.occlusion(0, 1.7, 0, 0, 60, -12)).toBe(0);
    expect(idx.occlusion(0, 1.7, 0, 0, 10, -12)).toBe(1);
    const hit = idx.firstHit(0, 0, 0, -1, 50);
    expect(hit?.d).toBeCloseTo(8, 3);
  });

  it('IR: sonlu, sönümlü, kanyonda daha uzun', () => {
    const [L] = makeImpulse(44100, { kind: 'canyon', width: 16, meanDist: 10, height: 20, rt60: 1.4 });
    const [Lo] = makeImpulse(44100, { kind: 'open', width: 60, meanDist: 60, height: 0, rt60: 0.35 });
    expect(L.length).toBeGreaterThan(Lo.length);
    expect(L.every(Number.isFinite)).toBe(true);
    const e = (a: Float32Array, i0: number, i1: number) => a.slice(i0, i1).reduce((s, v) => s + v * v, 0);
    expect(e(L, 0, 20000)).toBeGreaterThan(e(L, L.length - 20000, L.length));
  });
});

describe('ray, trafik, doğa zamanlaması', () => {
  it('BursaRay sefer aralığı', () => {
    expect(railHeadway(3 * 60)).toBeNull();
    expect(railHeadway(8 * 60)).toBe(5);
    expect(railHeadway(12 * 60)).toBeGreaterThanOrEqual(5);
    expect(railHeadway(12 * 60)).toBeLessThanOrEqual(8);
    expect(railHeadway(23 * 60 + 30)).toBe(15);
    expect(railHeadway(10)).toBe(15);
  });

  it('ray parçaları uç uca eklenir, köprü aralığı korunur', () => {
    const paths = chainRails([
      {
        kind: 'subway',
        pts: [
          [100, 0],
          [200, 0],
        ],
        tunnel: false,
        bridge: false,
      },
      {
        kind: 'subway',
        pts: [
          [0, 0],
          [100, 0],
        ],
        tunnel: false,
        bridge: true,
      },
      {
        kind: 'subway',
        pts: [
          [300, 0],
          [200, 0],
        ],
        tunnel: false,
        bridge: false,
      },
    ]);
    expect(paths.length).toBe(1);
    expect(paths[0].pts.length).toBe(4);
    expect(paths[0].bridge.length).toBe(1);
    const [a, b] = paths[0].bridge[0];
    expect(b - a).toBeCloseTo(100, 5);
    const n = nearestOnPolyline(paths[0].pts, 150, 5);
    expect(n.d).toBeCloseTo(5, 5);
  });

  it('trafik yoğunluğu: gece düşük, akşam zirvesi yüksek; yol sınıfı düzeyi', () => {
    expect(trafficDensity(3 * 60, 2)).toBeLessThan(0.15);
    expect(trafficDensity(18 * 60, 2)).toBeGreaterThan(0.9);
    expect(trafficDensity(8 * 60, 6)).toBeLessThan(trafficDensity(8 * 60, 2));
    expect(roadBedSpl('secondary')!).toBeGreaterThan(roadBedSpl('tertiary')!);
    expect(roadBedSpl('residential')).toBeNull();
    expect(TrafficSound.rpm(0, 0)).toBeLessThan(1000);
    expect(TrafficSound.rpm(13, 0)).toBeGreaterThan(1300);
  });

  it('kuş ve çocuk etkinliği', () => {
    const rise = 6 * 60 + 50;
    const set = 18 * 60 + 57;
    expect(birdActivity(2 * 60, rise, set)).toBe(0);
    expect(birdActivity(rise + 45, rise, set)).toBeGreaterThan(0.9);
    expect(birdActivity(13 * 60, rise, set)).toBeLessThan(birdActivity(rise + 45, rise, set));
    // Salı 17:00 okul çıkışı, Salı 10:00 okulda, Cumartesi 11:00 dışarıda
    expect(childrenActivity(17 * 60, 2, 10, 6)).toBe(1);
    expect(childrenActivity(10 * 60, 2, 10, 6)).toBe(0);
    expect(childrenActivity(11 * 60, 6, 10, 10)).toBeGreaterThan(0);
    expect(childrenActivity(23 * 60, 6, 10, 10)).toBe(0);
  });
});

describe('ses işleme hattı (scripts/sounds-lib.mjs)', () => {
  const SR = 8000;
  /** Gürültülü taban üzerinde her 0.5 s'de bir kısa darbe (adım). */
  function steps(n: number): Float32Array {
    const x = new Float32Array(SR * (n * 0.5 + 0.5));
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < x.length; i++) x[i] = rnd() * 0.002;
    for (let k = 0; k < n; k++) {
      const o = Math.round((0.25 + k * 0.5) * SR);
      for (let i = 0; i < SR * 0.06; i++) x[o + i] += rnd() * 0.6 * Math.exp(-i / (SR * 0.015));
    }
    return x;
  }

  it('adım başlangıçları bulunur ve dilimlenir', () => {
    const ev = detectEvents(steps(8), SR, { minGap: 0.2, maxLen: 0.4, minLen: 0.05 });
    expect(ev.length).toBe(8);
    for (let k = 0; k < ev.length; k++) {
      const t = ev[k].start / SR;
      expect(Math.abs(t - (0.25 + k * 0.5))).toBeLessThan(0.03);
      expect((ev[k].end - ev[k].start) / SR).toBeLessThanOrEqual(0.4);
    }
  });

  it('döngü dikişi sürekli (son örnek → ilk örnek)', () => {
    const n = SR * 4;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++)
      x[i] = Math.sin((i / SR) * 2 * Math.PI * 3.3) * 0.5 + Math.sin(i * 0.37) * 0.01;
    const [y] = makeLoop([x], SR, 0.5);
    expect(y.length).toBe(n - SR * 0.5);
    const jump = Math.abs(y[0] - y[y.length - 1]);
    const typical = Math.abs(y[1] - y[0]) + Math.abs(y[y.length - 1] - y[y.length - 2]);
    expect(jump).toBeLessThan(typical * 3 + 0.02);
  });

  it('sprite dilim zamanları', () => {
    const a = new Float32Array(800);
    const b = new Float32Array(400);
    const sp = packSprite(
      [
        { chans: [a], tag: 'walk' },
        { chans: [b], tag: 'run' },
      ],
      SR,
    );
    expect(sp.slices[0]).toEqual([0.05, 0.1, 'walk']);
    expect(sp.slices[1][0]).toBeCloseTo(0.05 + 0.1 + 0.08, 4);
    expect(sp.slices[1][2]).toBe('run');
  });

  it('lisans ayrıştırma ve Freesound sayfası', () => {
    expect(parseLicense('http://creativecommons.org/publicdomain/zero/1.0/').family).toBe('cc0');
    expect(parseLicense('https://creativecommons.org/licenses/by/4.0/')).toEqual({
      family: 'by',
      version: '4.0',
    });
    expect(parseLicense('https://creativecommons.org/licenses/by-nc/3.0/').family).toBe('by-nc');
    expect(parseLicense('http://creativecommons.org/licenses/sampling+/1.0/').family).toBe('sampling+');
    expect(parseLicense('Attribution NonCommercial 4.0').family).toBe('by-nc');
    const html = `<html><head><title>Freesound - "Footsteps in Gravel" by petebuchwald</title>
      <meta property="og:title" content="Footsteps in Gravel" />
      <meta property="og:audio" content="https://cdn.freesound.org/previews/273/273354_5121236-hq.mp3" /></head>
      <body><div>License</div><a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a></body></html>`;
    const p = parseFreesoundPage(html, 'https://freesound.org/people/petebuchwald/sounds/273354/');
    expect(p.preview).toBe('https://cdn.freesound.org/previews/273/273354_5121236-hq.mp3');
    expect(p.license?.family).toBe('cc0');
    expect(p.title).toBe('Footsteps in Gravel');
    expect(p.user).toBe('petebuchwald');
    const pack = parseFreesoundPack(
      '<a href="/people/sturmankin/sounds/272253/" title="x">concrete_17a_boots_walk.wav</a>' +
        '<a href="/people/sturmankin/sounds/272254/">concrete_18a_sneakers_walk.wav</a>',
      'sturmankin',
    );
    expect(pack.map((s) => s.id)).toEqual(['272253', '272254']);
    expect(pack[1].name).toBe('concrete_18a_sneakers_walk.wav');
    // Bağlantısız lisans metni: NC asla CC BY sanılmamalı
    const nc = parseFreesoundPage(
      '<p>Some attribution text</p><h3>License</h3><span>This sound is licensed under the Attribution NonCommercial 4.0 License.</span>',
    );
    expect(nc.license?.family).toBe('by-nc');
    const by = parseFreesoundPage('<h3>License</h3><span>Attribution 4.0</span>');
    expect(by.license).toEqual({ family: 'by', version: '4.0' });
    expect(parseFreesoundPage('<p>no license info</p>').license).toBeNull();
  });
});
