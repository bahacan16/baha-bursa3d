import { it } from 'vitest';
import { speciesModel } from '../../src/worlds/osm/treelib';
import { SPECIES, SPECIES_SIZE } from '../../src/worlds/osm/species';
it('measure', () => {
  for (const k of SPECIES) {
    const m = speciesModel(k);
    const p = m.near.leaves.attributes.position;
    let maxY = 0;
    for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
    const NS = 10;
    const sl: number[][] = Array.from({ length: NS }, () => []);
    for (let i = 0; i < p.count; i++) sl[Math.max(0, Math.min(NS - 1, Math.floor((p.getY(i) / maxY) * NS)))].push(Math.hypot(p.getX(i), p.getZ(i)));
    const out = sl.map((s) => { s.sort((a, b) => a - b); return s.length > 40 ? 2 * s[Math.floor(0.95 * (s.length - 1))] : 0; });
    const w95 = Math.max(...out);
    const out90 = sl.map((s) => (s.length > 40 ? 2 * s[Math.floor(0.9 * (s.length - 1))] : 0));
    console.log(k.padEnd(15), 'W', SPECIES_SIZE[k].w, 'slice95max', w95.toFixed(2), 'slice90max', Math.max(...out90).toFixed(2), 'ratio', (w95 / SPECIES_SIZE[k].w).toFixed(2), out.map((v) => v.toFixed(1)).join(','));
  }
});
