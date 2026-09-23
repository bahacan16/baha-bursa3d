import { distToSegment, pointInPolygon, type OsmWorldData, type Pt, type Ring } from '../worlds/osm/parse';

interface Seg {
  a: Pt;
  b: Pt;
  name: string;
  half: number;
}

/** Konuma göre en yakın isimli yol veya bulunulan site/park adı. */
export class StreetLocator {
  private grid = new Map<string, Seg[]>();
  private areas: { name: string; outer: Ring; holes: Ring[]; size: number }[] = [];
  private static CELL = 40;

  constructor(d: OsmWorldData) {
    for (const r of d.roads) {
      if (!r.name || r.tunnel) continue;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const s: Seg = { a: r.pts[i], b: r.pts[i + 1], name: r.name, half: r.width / 2 };
        const C = StreetLocator.CELL;
        for (
          let x = Math.floor(Math.min(s.a[0], s.b[0]) / C) - 1;
          x <= Math.floor(Math.max(s.a[0], s.b[0]) / C) + 1;
          x++
        )
          for (
            let z = Math.floor(Math.min(s.a[1], s.b[1]) / C) - 1;
            z <= Math.floor(Math.max(s.a[1], s.b[1]) / C) + 1;
            z++
          ) {
            const k = `${x},${z}`;
            let arr = this.grid.get(k);
            if (!arr) this.grid.set(k, (arr = []));
            arr.push(s);
          }
      }
    }
    for (const a of d.areas) {
      if (!a.name) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of a.outer) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[1]);
        maxZ = Math.max(maxZ, p[1]);
      }
      this.areas.push({ name: a.name, outer: a.outer, holes: a.holes, size: (maxX - minX) * (maxZ - minZ) });
    }
    this.areas.sort((p, q) => p.size - q.size);
  }

  nearestRoad(x: number, z: number, maxDist: number): { name: string; dist: number } | null {
    const C = StreetLocator.CELL;
    let best: { name: string; dist: number; half: number } | null = null;
    for (const s of this.grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
      const d = Math.max(0, distToSegment(x, z, s.a, s.b) - s.half);
      if (d > maxDist) continue;
      // Kavşakta eşitlik: geniş yol öncelikli
      if (!best || d < best.dist - 0.01 || (Math.abs(d - best.dist) <= 0.01 && s.half > best.half))
        best = { name: s.name, dist: d, half: s.half };
    }
    return best ? { name: best.name, dist: best.dist } : null;
  }

  areaAt(x: number, z: number): string | null {
    for (const a of this.areas) if (pointInPolygon(x, z, a.outer, a.holes)) return a.name;
    return null;
  }

  /** GTA tarzı: yol üzerindeyken/yakınken yol adı, değilse site/park adı, o da yoksa uzaktaki yol. */
  locate(x: number, z: number): string | null {
    const road = this.nearestRoad(x, z, 6);
    if (road) return road.name;
    const area = this.areaAt(x, z);
    if (area) return area;
    return this.nearestRoad(x, z, 40)?.name ?? null;
  }
}

/** Sağ altta beliren/solan sokak adı. */
export class StreetNameHud {
  readonly el: HTMLDivElement;
  private streetEl: HTMLDivElement;
  private current: string | null = null;
  private timer = 0;
  private pending: string | null = null;
  private pendingSince = 0;

  constructor(parent: HTMLElement, areaLabel: string) {
    this.el = document.createElement('div');
    this.el.className = 'streetname hud-el';
    this.el.innerHTML = `<div class="area"></div><div class="street" data-testid="street-name"></div>`;
    this.el.querySelector('.area')!.textContent = areaLabel;
    this.streetEl = this.el.querySelector('.street')!;
    parent.appendChild(this.el);
  }

  get text(): string {
    return this.current ?? '';
  }

  update(name: string | null, now: number): void {
    if (name && name !== this.current) {
      // Titremeyi önlemek için yeni ad 0.4 sn sabit kalsın
      if (this.pending !== name) {
        this.pending = name;
        this.pendingSince = now;
      } else if (now - this.pendingSince > 0.4 || !this.current) {
        this.current = name;
        this.streetEl.textContent = name;
        this.el.classList.remove('show');
        void this.el.offsetWidth;
        this.el.classList.add('show');
        this.timer = now;
      }
    } else if (name === this.current) this.pending = null;
    if (this.el.classList.contains('show') && now - this.timer > 5) this.el.classList.remove('show');
  }

  /** Harita kapandığında vb. yeniden göster. */
  flash(now: number): void {
    if (!this.current) return;
    this.el.classList.add('show');
    this.timer = now;
  }
}
