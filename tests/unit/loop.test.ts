import { describe, expect, it } from 'vitest';
import { Accumulator, FIXED_DT } from '../../src/core/loop';

describe('Accumulator', () => {
  it('sabit adım sayısını doğru hesaplar', () => {
    const a = new Accumulator();
    expect(a.advance(FIXED_DT * 2.5)).toBe(2);
    expect(a.alpha).toBeCloseTo(0.5);
    expect(a.advance(FIXED_DT * 0.5)).toBe(1);
  });

  it('uzun kareleri sınırlar (spiral of death yok)', () => {
    const a = new Accumulator();
    expect(a.advance(5)).toBeLessThanOrEqual(15);
  });
});
