import { it } from 'vitest';
import { speciesModel } from '../../src/worlds/osm/treelib';
import { SPECIES, SPECIES_SIZE } from '../../src/worlds/osm/species';
it('measure', () => {
  for (const k of SPECIES) {
    let m;
    try { m = speciesModel(k); } catch (e) { console.log(k, 'ERR', String(e)); continue; }
    const p = m.near.leaves.attributes.position;
    const rs: number[] = [];
    let maxY = 0, minX = 1e9, maxX = -1e9;
    for (let i = 0; i < p.count; i++) { rs.push(Math.hypot(p.getX(i), p.getZ(i))); maxY = Math.max(maxY, p.getY(i)); minX=Math.min(minX,p.getX(i)); maxX=Math.max(maxX,p.getX(i)); }
    rs.sort((a, b) => a - b);
    const q = (f: number) => (2 * rs[Math.floor(f * (rs.length - 1))]).toFixed(2);
    // yarıçap dağılımı sektörlere göre: 8 sektörde %90 yarıçap ortalaması
    const sec: number[][] = Array.from({ length: 8 }, () => []);
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); sec[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8].push(Math.hypot(p.getX(i), p.getZ(i))); }
    const s90 = sec.map((s) => { s.sort((a, b) => a - b); return s[Math.floor(0.9 * (s.length - 1))] ?? 0; });
    console.log(k.padEnd(15), 'W', SPECIES_SIZE[k].w, 'H', SPECIES_SIZE[k].h, 'maxY', maxY.toFixed(2), 'bboxX', (maxX-minX).toFixed(2), 'p50', q(0.5), 'p90', q(0.9), 'p98', q(0.98), 'max', q(1), 'sect90', s90.map((v) => (2 * v).toFixed(1)).join(','));
  }
});
