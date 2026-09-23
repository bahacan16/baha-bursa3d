import { ringCentroid, type OsmWorldData, type Pt } from '../worlds/osm/parse';

export interface Place {
  label: string;
  x: number;
  z: number;
}

/** Türkçe duyarlı küçük harf + noktalama temizliği. */
export function norm(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[.,;:()'"’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Known {
  label: string;
  /** Hepsi adda geçmeli (normalize). */
  must: string[];
  kind: 'road' | 'station' | 'any';
}

// Bilinen yerler: KOORDİNAT YOK — OSM'de adıyla aranır, bulunanlar menüye eklenir.
const KNOWN: Known[] = [
  { label: 'Bursaray Özlüce İstasyonu', must: ['özlüce'], kind: 'station' },
  { label: 'Uğur Mumcu Bulvarı', must: ['uğur mumcu'], kind: 'road' },
  { label: 'Bursaspor Özlüce Tesisleri', must: ['bursaspor'], kind: 'any' },
  { label: 'Tarabya Sitesi', must: ['tarabya'], kind: 'any' },
  { label: 'Mertkent 3 Sitesi', must: ['mertkent 3'], kind: 'any' },
  { label: 'Doğan Avcıoğlu Caddesi', must: ['doğan avcıoğlu'], kind: 'road' },
  { label: 'Ahmet Taner Kışlalı Bulvarı', must: ['kışlalı'], kind: 'road' },
];

const STATION_KINDS = new Set(['station', 'stop', 'halt', 'tram_stop']);

export function findPlaces(d: OsmWorldData, maxR = 1000): Place[] {
  const out: Place[] = [{ label: '502. Sokak (başlangıç)', x: 0, z: 0 }];
  const inRange = (p: Pt) => Math.hypot(p[0], p[1]) <= maxR - 5;
  for (const k of KNOWN) {
    const match = (name: string | undefined) => !!name && k.must.every((m) => norm(name).includes(m));
    let best: Pt | null = null;
    let bestName = '';
    let bestD = Infinity;
    const consider = (p: Pt, name: string) => {
      const dd = Math.hypot(p[0], p[1]);
      if (inRange(p) && dd < bestD) {
        bestD = dd;
        best = p;
        bestName = name;
      }
    };
    if (k.kind === 'road') {
      for (const r of d.roads) if (match(r.name)) for (const p of r.pts) consider(p, r.name!);
    } else {
      for (const p of d.pois) {
        if (!match(p.name)) continue;
        if (k.kind === 'station' && !STATION_KINDS.has(p.kind)) continue;
        consider([p.x, p.z], p.name);
      }
      if (!best && k.kind === 'any')
        for (const a of d.areas) if (match(a.name)) consider(ringCentroid(a.outer), a.name!);
    }
    // Etiket OSM'deki gerçek addır (uydurma/eşleştirilmiş ad gösterilmez).
    if (best) {
      const label = k.kind === 'station' ? `${bestName} (Bursaray)` : bestName;
      if (!out.some((o) => o.label === label)) out.push({ label, x: (best as Pt)[0], z: (best as Pt)[1] });
    }
  }
  return out;
}
