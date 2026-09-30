import { it } from 'vitest';
import { Builder } from '../../src/worlds/mertkent/builder';
import { buildStreetPlan } from '../../src/worlds/mertkent/street';
import STREET_PLAN from '../../src/worlds/mertkent/data/street-plan.json';
it('probe', () => {
  const b = new Builder();
  buildStreetPlan(b, STREET_PLAN as never, () => 0, () => 5, { colorKey: ((k: string, h: string) => `cc_${k}_${h}`) as never, signFace: (s) => 'face:' + s.text });
  const bk = (b as unknown as { buckets: Map<string, { pos: number[]; idx: number[] }> }).buckets;
  for (const [k, v] of bk) {
    let n = 0; let y = 0;
    for (let i = 0; i < v.pos.length; i += 3) { const x = v.pos[i], z = v.pos[i + 2]; if (x > 614 && x < 626 && z > -480 && z < -462) { n++; y = v.pos[i + 1]; } }
    if (n) console.log(k, n, y.toFixed(3));
  }
});
