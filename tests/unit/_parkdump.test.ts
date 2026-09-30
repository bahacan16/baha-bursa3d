import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { parkingBlockers, parkingCars, type ParkingStrip } from '../../src/sim/parked';
import SP from '../../src/worlds/measured/data/street-plan.json';
it('dump', () => {
  const sp = SP as unknown as { parking: ParkingStrip[]; street: never[]; gates: never[] };
  const bl = parkingBlockers(sp.street, sp.gates);
  const per: Record<string, number[]> = {};
  for (const s of sp.parking) per[s.id] = parkingCars([s], () => 0, bl);
  writeFileSync(process.env.OUT!, JSON.stringify({ per, bl }));
});
