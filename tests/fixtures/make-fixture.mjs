// Küçük, SENTETİK Overpass fixture'ı üretir (ağ gerektirmeyen testler/geliştirme için).
// Gerçek veri değildir: geometriler elle tasarlanmış, konum merkez etrafına yerleştirilmiştir.
// Kullanım: node tests/fixtures/make-fixture.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CENTER_LITE, unproject } from '../../src/worlds/osm/simplify.ts';

const C = DEFAULT_CENTER_LITE;
const elements = [];
let nid = 1;
let wid = 1000;
const nodeAt = new Map();

function node(x, z, tags) {
  const key = `${x},${z}`;
  if (!tags && nodeAt.has(key)) return nodeAt.get(key);
  const ll = unproject(x, z, C);
  const id = nid++;
  const e = { type: 'node', id, lat: +ll.lat.toFixed(7), lon: +ll.lon.toFixed(7) };
  if (tags) e.tags = tags;
  elements.push(e);
  if (!tags) nodeAt.set(key, id);
  return id;
}

function way(pts, tags, close = false) {
  const ids = pts.map(([x, z]) => node(x, z));
  if (close) ids.push(ids[0]);
  const e = { type: 'way', id: wid++, nodes: ids };
  if (tags) e.tags = tags;
  elements.push(e);
  return e.id;
}

function rect(cx, cz, w, d, rot = 0) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, z]) => [+(cx + x * c - z * s).toFixed(2), +(cz + x * s + z * c).toFixed(2)]);
}

// --- Yollar ---
way([[-150, 0], [-60, 0], [0, 0], [80, 0], [160, 0]], { highway: 'residential', name: '502. Sokak' });
way([[-150, -120], [-150, 0], [-150, 120]], { highway: 'residential', name: '503. Sokak' });
way([[-150, -90], [160, -90]], { highway: 'residential', name: '501. Sokak' });
way([[160, -200], [160, -90], [160, 0], [160, 180], [160, 260]], {
  highway: 'secondary',
  name: 'Doğan Avcıoğlu Caddesi',
});
way([[-320, 180], [-150, 180], [160, 180], [320, 180]], {
  highway: 'primary',
  name: 'Uğur Mumcu Bulvarı',
  lanes: '4',
});
way([[-150, 120], [-150, 180]], { highway: 'residential', name: '503. Sokak' });
way([[40, 0], [40, 40], [70, 55]], { highway: 'service' });
way([[-100, 60], [-60, 100], [0, 130], [60, 120]], { highway: 'footway' });
// Yaya geçidi (502. Sokak üzerinde paylaşılan node)
const cross = elements.find((e) => e.type === 'node' && e.id === nodeAt.get('0,0'));
cross.tags = { highway: 'crossing', crossing: 'zebra' };

// --- Raylar (Bursaray) ---
way([[-320, 235], [-120, 235]], { railway: 'light_rail', name: 'Bursaray' });
way([[-120, 235], [60, 235]], { railway: 'light_rail', name: 'Bursaray', bridge: 'yes', layer: '1' });
way([[60, 235], [320, 235]], { railway: 'light_rail', name: 'Bursaray' });
node(-200, 228, { railway: 'station', name: 'Özlüce', public_transport: 'station' });

// --- Binalar ---
const levels = [4, 6, 5, 8, 7, 5, 6, 4];
for (let i = 0; i < 8; i++) {
  const x = -120 + i * 32;
  if (Math.abs(x - 40) < 12) continue;
  way(rect(x, -22, 18, 12), { building: 'apartments', 'building:levels': String(levels[i]) }, true);
  const t = i % 3 === 0 ? { building: 'yes' } : { building: 'residential', 'building:levels': String(levels[7 - i]) };
  way(rect(x, 24, 16, 14), t, true);
}
way(rect(-110, -60, 10, 9), { building: 'house' }, true);
way(rect(-85, -60, 12, 10), { building: 'house', 'roof:shape': 'gabled' }, true);
way(rect(-60, -60, 14, 12), { building: 'residential', 'building:levels': '3', 'roof:shape': 'hipped' }, true);
way(rect(-35, -60, 12, 12), { building: 'commercial', height: '9.5' }, true);
way(
  [[0, -50], [30, -50], [30, -70], [20, -70], [20, -60], [0, -60]],
  { building: 'retail', 'building:levels': '2', name: 'Test Çarşısı' },
  true,
);
node(10, -55, { shop: 'supermarket', name: 'Test Market' });
// Avlulu blok (multipolygon + delik)
const outer = way([[60, -40], [130, -40], [130, -75], [60, -75]].map((p) => p), null, true);
const inner = way([[75, -50], [115, -50], [115, -65], [75, -65]], null, true);
elements.push({
  type: 'relation',
  id: 5001,
  members: [
    { type: 'way', ref: outer, role: 'outer' },
    { type: 'way', ref: inner, role: 'inner' },
  ],
  tags: { type: 'multipolygon', building: 'apartments', 'building:levels': '6' },
});
// building:part içeren bina (ana gövde çizilmemeli)
way(rect(-40, 150, 30, 16), { building: 'office', name: 'Parçalı Bina' }, true);
way(rect(-47.5, 150, 15, 16), { 'building:part': 'yes', 'building:levels': '10' }, true);
way(rect(-32.5, 150, 15, 16), { 'building:part': 'yes', 'building:levels': '3' }, true);
way(rect(120, 60, 22, 14, 0.3), { building: 'school', name: 'Test Okulu' }, true);

// --- Alanlar ---
way(
  [[-140, 10], [150, 10], [150, 45], [-140, 45]],
  { landuse: 'residential', name: 'Örnek Sitesi' },
  true,
);
way([[-120, 60], [20, 60], [20, 140], [-120, 140]], { leisure: 'park', name: 'Test Parkı' }, true);
way(rect(70, 95, 40, 24), { leisure: 'pitch', sport: 'soccer' }, true);
way(rect(-20, 90, 14, 12), { leisure: 'playground' }, true);
way(rect(100, 125, 30, 20), { amenity: 'parking' }, true);
way([[-300, 60], [-200, 60], [-200, 140], [-300, 140]], { natural: 'wood' }, true);
way(rect(-250, -60, 40, 25), { natural: 'water' }, true);

// --- Bariyerler ---
way([[-140, 8], [150, 8]], { barrier: 'wall' });
way([[50, 82], [90, 82], [90, 108]], { barrier: 'fence' });

// --- Ağaçlar / lambalar ---
for (let x = -140; x <= 150; x += 14) node(x, 6.5, { natural: 'tree' });
way([[-145, -110], [-145, 110]], { natural: 'tree_row' });
for (let x = -140; x <= 150; x += 30) node(x, -6.5, { highway: 'street_lamp' });

const out = { version: 0.6, generator: 'nilufer-walk synthetic fixture', elements };
const file = join(dirname(fileURLToPath(import.meta.url)), 'osm-small.json');
writeFileSync(file, JSON.stringify(out));
console.log(`fixture: ${elements.length} öğe → ${file}`);
