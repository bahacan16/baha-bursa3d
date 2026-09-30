import { describe, expect, it } from 'vitest';
import { parkingBlockers, parkingCars, ringsOverlap, type ParkingStrip } from '../../src/sim/parked';
import STREET_PLAN from '../../src/worlds/measured/data/street-plan.json';

const flat = () => 0;
const cars = (d: number[]) => {
  const r: { x: number; z: number; yaw: number; seed: number }[] = [];
  for (let i = 0; i < d.length; i += 5) r.push({ x: d[i], z: d[i + 2], yaw: d[i + 3], seed: d[i + 4] });
  return r;
};

describe('ölçülmüş park şeritleri (parkingCars)', () => {
  const para: ParkingStrip = {
    id: 't-para',
    line: [
      [0, 0],
      [0, 26],
    ],
    mode: 'parallel',
    nose: 'fwd',
    pitch: 5.2,
    occupancy: 1,
  };

  it('dolu paralel şerit: her yuvada bir araç, hat üzerinde, hat yönünde', () => {
    const c = cars(parkingCars([para], flat));
    expect(c.length).toBe(5);
    for (const q of c) {
      expect(q.x).toBeCloseTo(0, 6);
      expect(Math.abs(q.yaw)).toBeLessThan(0.02); // +z yönü (yaw 0) ± yamukluk
    }
    for (let i = 1; i < c.length; i++) expect(c[i].z - c[i - 1].z).toBeCloseTo(5.2, 6);
  });

  it('deterministik: aynı girdi aynı çıktı; doluluk oranı tutuyor', () => {
    const s: ParkingStrip = {
      ...para,
      id: 't-occ',
      line: [
        [0, 0],
        [0, 520],
      ],
      occupancy: 0.5,
    };
    const a = parkingCars([s], flat);
    expect(parkingCars([s], flat)).toEqual(a);
    const n = a.length / 5;
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThan(70);
  });

  it('görülen araçlar (at) en yakın boş yuvaya oturur, doluluk yalnız bunlardan', () => {
    const s: ParkingStrip = {
      ...para,
      occupancy: undefined,
      at: [
        [0.4, 7.9],
        [0, 8.1],
        [0, 20],
      ],
    };
    const c = cars(parkingCars([s], flat));
    expect(c.map((q) => q.z)).toEqual([7.8, 13, 18.2].map((z) => expect.closeTo(z, 6)));
  });

  it('dik / açılı: burun istenen yanda', () => {
    const line: [number, number][] = [
      [0, 0],
      [20, 0],
    ];
    const perp = cars(
      parkingCars([{ id: 'p', line, mode: 'perpendicular', nose: 'right', pitch: 2.6, occupancy: 1 }], flat),
    );
    // doğuya giden hatta sağ = güney (+z) → yaw ≈ 0
    for (const q of perp) expect(Math.abs(q.yaw)).toBeLessThan(0.02);
    const ang = cars(
      parkingCars([{ id: 'a', line, mode: 'angled', angle: 60, nose: 'left', pitch: 3, occupancy: 1 }], flat),
    );
    // sol = kuzey (−z), doğuya yatık: ileri vektör (cos60, −sin60) → yaw = atan2(0.5, −0.866)
    for (const q of ang) expect(q.yaw).toBeCloseTo(Math.atan2(0.5, -Math.sqrt(3) / 2), 1);
  });

  it('yaya geçidi, durak ve ada önündeki yuvalar boş kalır', () => {
    const bl = parkingBlockers([
      { kind: 'crossing', x: 3, z: 10, rot: 90, len: 6, w: 3 },
      { kind: 'bus-shelter', x: -2, z: 20.5, rot: 90, w: 3 },
    ]);
    const c = cars(parkingCars([para], flat, bl));
    for (const q of c) {
      expect(Math.abs(q.z - 10)).toBeGreaterThan(3.5);
      expect(Math.abs(q.z - 20.5)).toBeGreaterThan(4);
    }
    expect(c.length).toBeLessThan(5);
  });

  it('ringsOverlap: içerme ve kesişme', () => {
    const sq = (x: number, s: number): [number, number][] => [
      [x, 0],
      [x + s, 0],
      [x + s, s],
      [x, s],
    ];
    expect(ringsOverlap(sq(0, 4), sq(1, 1))).toBe(true);
    expect(ringsOverlap(sq(0, 2), sq(1, 2))).toBe(true);
    expect(ringsOverlap(sq(0, 1), sq(3, 1))).toBe(false);
  });
});

describe('street-plan.json parking kayıtları', () => {
  const sp = STREET_PLAN as unknown as {
    parking: ParkingStrip[];
    street: Parameters<typeof parkingBlockers>[0];
    gates: Parameters<typeof parkingBlockers>[1];
  };
  const bl = parkingBlockers(sp.street, sp.gates);
  const all = cars(parkingCars(sp.parking, flat, bl));

  it('D4 şeritleri araç üretir, sonlu, D4 kutusunda', () => {
    expect(sp.parking.length).toBeGreaterThan(10);
    expect(all.length).toBeGreaterThan(150);
    for (const q of all) {
      expect(Number.isFinite(q.x) && Number.isFinite(q.z) && Number.isFinite(q.yaw)).toBe(true);
      expect(q.x).toBeGreaterThan(530);
      expect(q.x).toBeLessThan(800);
      expect(q.z).toBeGreaterThan(-850);
      expect(q.z).toBeLessThan(-100);
    }
  });

  it('araçlar üst üste binmiyor', () => {
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
        expect(d).toBeGreaterThan(2.3);
      }
  });

  it('hiçbir araç geçit / durak / ada alanına değmiyor', () => {
    for (const q of all) {
      const f: [number, number] = [Math.sin(q.yaw), Math.cos(q.yaw)];
      const v: [number, number] = [-f[1], f[0]];
      const box: [number, number][] = [
        [q.x + f[0] * 2.2 + v[0] * 0.9, q.z + f[1] * 2.2 + v[1] * 0.9],
        [q.x - f[0] * 2.2 + v[0] * 0.9, q.z - f[1] * 2.2 + v[1] * 0.9],
        [q.x - f[0] * 2.2 - v[0] * 0.9, q.z - f[1] * 2.2 - v[1] * 0.9],
        [q.x + f[0] * 2.2 - v[0] * 0.9, q.z + f[1] * 2.2 - v[1] * 0.9],
      ];
      expect(bl.some((b) => ringsOverlap(box, b))).toBe(false);
    }
  });
});
