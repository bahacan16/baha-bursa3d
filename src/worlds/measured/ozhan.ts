import { Builder, type V2 } from './builder';
import { orientOutward } from './apartment';

/**
 * Özhan Market (Street View): tek katlı; beyaz, yatay oluklu panel cephe; kalın kiremit-kahve saçak bandı.
 * Kuzey cephe vitrin: kahve kolonlar arasında üstte koyu cam bant, altta sarı indirim afişleri, batı ucunda cam giriş;
 * saçak üstünde turuncu "özhan" harfleri, altında renkli flamalar.
 * Doğu cephe: sarı "Birbirinden Avantajlı İndirim ve Kampanyalar ÖZHAN'da" pankartı, önünde gri ızgaralı çöp muhafazası.
 */
const WALL_H = 3.45;
const FASCIA_H = 1.35;
const FASCIA_OUT = 0.4;
const BAY = 3.2;

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

export function buildOzhan(b: Builder, ring0: V2[], y0: number, collide?: Collide): void {
  const r = orientOutward(ring0);
  const top = y0 + WALL_H + FASCIA_H;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const e = r[(i + 1) % r.length];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (len < 0.3) continue;
    const t: V2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
    const n: V2 = [-t[1], t[0]];
    const P = (u: number, off = 0): V2 => [a[0] + t[0] * u + n[0] * off, a[1] + t[1] * u + n[1] * off];
    const yaw = Math.atan2(-t[1], t[0]);
    const north = n[1] < -0.7;
    const east = n[0] > 0.7;
    // Saçak bandı (dışarı taşan)
    b.wall('ozFascia', P(-FASCIA_OUT, FASCIA_OUT), P(len + FASCIA_OUT, FASCIA_OUT), y0 + WALL_H - 0.05, top, [
      0,
      0,
      len / 3,
      1,
    ]);
    b.quad(
      'ozFascia',
      [P(len + FASCIA_OUT, FASCIA_OUT)[0], y0 + WALL_H - 0.05, P(len + FASCIA_OUT, FASCIA_OUT)[1]],
      [P(-FASCIA_OUT, FASCIA_OUT)[0], y0 + WALL_H - 0.05, P(-FASCIA_OUT, FASCIA_OUT)[1]],
      [P(-FASCIA_OUT, 0)[0], y0 + WALL_H - 0.05, P(-FASCIA_OUT, 0)[1]],
      [P(len + FASCIA_OUT, 0)[0], y0 + WALL_H - 0.05, P(len + FASCIA_OUT, 0)[1]],
    );
    if (!north) {
      b.wall('ozSiding', a, e, y0 - 0.3, y0 + WALL_H, [0, 0, len / 2, (WALL_H + 0.3) / 2]);
    } else {
      // Vitrin: bölmeler
      b.wall('ozDark', a, e, y0 - 0.3, y0 + WALL_H);
      const bays = Math.max(1, Math.round(len / BAY));
      const bw = len / bays;
      for (let k = 0; k < bays; k++) {
        const u0 = k * bw + 0.2;
        const u1 = (k + 1) * bw - 0.2;
        // Kahve kolon
        const cp = P(k * bw, 0.12);
        b.box('ozFascia', [cp[0], y0 + WALL_H / 2, cp[1]], [0.4, WALL_H, 0.25], yaw);
        if (k === 0) {
          // Giriş: cam kapı + yan afiş
          b.wall('ozDoor', P(u0 + 0.9, 0.05), P(u1 - 0.1, 0.05), y0, y0 + 2.4);
          b.wall('ozPosterOzel', P(u0, 0.05), P(u0 + 0.85, 0.05), y0 + 0.2, y0 + 2.1);
        } else {
          const v = ['ozPosterSahane', 'ozPosterPlain', 'ozPosterFood'][k % 3];
          b.wall(v, P(u0, 0.05), P(u1, 0.05), y0 + 0.1, y0 + 2.15);
        }
        b.wall('ozGlass', P(u0, 0.04), P(u1, 0.04), y0 + 2.2, y0 + WALL_H - 0.05);
      }
      const lp = P(len, 0.12);
      b.box('ozFascia', [lp[0], y0 + WALL_H / 2, lp[1]], [0.4, WALL_H, 0.25], yaw);
      // Logo: doğu yarısında, saçağın üstüne taşan
      const lw = Math.min(10, len * 0.48);
      const lu = len * 0.5;
      b.wall(
        'ozLogo',
        P(lu - lw / 2, FASCIA_OUT + 0.08),
        P(lu + lw / 2, FASCIA_OUT + 0.08),
        y0 + WALL_H - 0.1,
        y0 + WALL_H - 0.1 + lw * 0.29,
      );
      // Flamalar
      b.wall(
        'ozPennant',
        P(0, FASCIA_OUT + 0.05),
        P(len, FASCIA_OUT + 0.05),
        y0 + WALL_H - 0.45,
        y0 + WALL_H - 0.05,
        [0, 0, len / 2, 1],
      );
    }
    if (east) {
      // Pankart (kuzey uca yakın)
      const bw2 = Math.min(4.4, len * 0.5);
      const u = len - bw2 - 0.8;
      b.wall('ozBanner', P(u, 0.04), P(u + bw2, 0.04), y0 + 0.25, y0 + 0.25 + bw2 * 0.78);
      // Çöp muhafazası (gri ızgara) — pankartın önünde
      const cp = P(u - 1.2, 1.1);
      b.box('ozSlat', [cp[0], y0 + 1.05, cp[1]], [3.6, 2.1, 1.6], yaw, 0.5);
    }
  }
  b.polygon('ozRoof', r, top, true, 0.25);
  collide?.(
    r.map((p) => [p[0], p[1]]),
    y0 - 1,
    top,
  );
}
