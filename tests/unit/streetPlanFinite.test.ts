import { it, expect } from 'vitest';
import { Builder } from '../../src/worlds/measured/builder';
import { buildStreetPlan } from '../../src/worlds/measured/street';
import { buildSitePlan } from '../../src/worlds/measured/siteplan';
import STREET_PLAN from '../../src/worlds/measured/data/street-plan.json';
import SITE from '../../src/worlds/measured/data/site-plan.json';
import PARK from '../../src/worlds/measured/data/park-plan.json';
it('sokak + site + park planı geometrisi sonlu (NaN yok)', () => {
  const b = new Builder();
  const r = buildStreetPlan(
    b,
    STREET_PLAN as never,
    () => 0,
    () => 5,
    { colorKey: ((k: string, h: string) => `cc_${k}_${h}`) as never, signFace: () => 'face', bevel: 0.015 },
  );
  buildSitePlan(b, SITE as never, () => 0, undefined, undefined, r.coverPolys);
  buildSitePlan(b, PARK as never, () => 0, undefined, undefined, r.coverPolys);
  const bk = (b as unknown as { buckets: Map<string, { pos: number[] }> }).buckets;
  const bad: string[] = [];
  for (const [k, v] of bk) if (v.pos.some((q) => !Number.isFinite(q))) bad.push(k);
  console.log('BAD', bad);
  expect(bad).toEqual([]);
});
