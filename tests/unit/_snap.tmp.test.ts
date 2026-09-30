import { it } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Builder } from '../../src/worlds/measured/builder';
import { buildFacadeBlock, type CompiledBlock } from '../../src/worlds/measured/facade';
import { splitMassing } from '../../src/worlds/measured/massing';
import { buildStreetPlan } from '../../src/worlds/measured/street';

const OUT = process.env.SNAP_OUT ?? '/tmp/claude-0/-home-user-baha-bursa3d/9fbfe8cf-5446-578a-8300-9e66ce23fe1c/scratchpad/v9/snap.json';
type Bk = { pos: number[]; idx: number[]; uv: number[]; nor: number[]; aux: number[] | null };
const hashB = (b: Builder) => {
  const bk = (b as unknown as { buckets: Map<string, Bk> }).buckets;
  const o: Record<string, string> = {};
  for (const [k, v] of [...bk.entries()].sort()) {
    const h = createHash('md5');
    h.update(new Float32Array(v.pos.map((x) => Math.round(x * 1e4) / 1e4)));
    h.update(new Uint32Array(v.idx));
    h.update(new Float32Array(v.uv.map((x) => Math.round(x * 1e4) / 1e4)));
    if (v.aux) h.update(new Float32Array(v.aux));
    o[k] = h.digest('hex').slice(0, 12) + ':' + v.idx.length;
  }
  const ic = (b as unknown as { protos: Map<string, { pb: Builder; mats: { elements: number[] }[]; cols: unknown[] }> }).protos;
  for (const [k, e] of [...ic.entries()].sort()) {
    const h = createHash('md5');
    h.update(JSON.stringify(e.mats.map((m) => m.elements.map((x) => Math.round(x * 1e4) / 1e4))));
    h.update(JSON.stringify(e.cols));
    h.update(JSON.stringify(hashB(e.pb)));
    o['inst:' + k] = h.digest('hex').slice(0, 12);
  }
  return o;
};
it('snapshot', () => {
  const F = JSON.parse(readFileSync('src/worlds/measured/data/facades.json', 'utf8')) as Record<string, CompiledBlock>;
  const SP = JSON.parse(readFileSync('src/worlds/measured/data/street-plan.json', 'utf8'));
  const res: Record<string, unknown> = {};
  const opts = { colorKey: (k: string, h: string) => `cc_${k}_${h}`, signFace: (s: { text?: string }) => `sign_${s.text ?? ''}` };
  for (const [id, blk] of Object.entries(F)) {
    for (const bev of [0, 0.015]) {
      const b = new Builder();
      try {
        for (const p of splitMassing(blk)) buildFacadeBlock(b, p, 0, { seed: Number(id) % 100000, bevel: bev, ...(opts as object) } as never);
        res[`${id}@${bev}`] = hashB(b);
      } catch (e) {
        res[`${id}@${bev}`] = 'ERR ' + String(e);
      }
    }
  }
  // Sokak: öğe başına
  SP.street.forEach((s: { id?: string }, i: number) => {
    const b = new Builder();
    try {
      buildStreetPlan(b, { street: [s] } as never, () => 0, () => 5, opts as never);
      res[`street#${i}:${s.id ?? ''}`] = hashB(b);
    } catch (e) {
      res[`street#${i}:${s.id ?? ''}`] = 'ERR ' + String(e);
    }
  });
  for (const k of ['sidewalks', 'areas', 'fence', 'gates', 'roads'] as const)
    (SP[k] ?? []).forEach((s: { id?: string }, i: number) => {
      const b = new Builder();
      try {
        buildStreetPlan(b, { street: [], [k]: [s] } as never, () => 0, () => 5, opts as never);
        res[`${k}#${i}:${s.id ?? ''}`] = hashB(b);
      } catch (e) {
        res[`${k}#${i}:${s.id ?? ''}`] = 'ERR ' + String(e);
      }
    });
  writeFileSync(OUT, JSON.stringify(res));
}, 1200000);
