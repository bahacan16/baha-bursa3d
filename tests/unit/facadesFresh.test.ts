import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Derlenmiş cephe verisi (data/facades.json) survey dosyalarıyla güncel olmalı: eski bir kopyadan derleyip geri
// yazmak binaları sessizce geri almıştı (2026-10-01: 18 bina, üç yeni blok kayıp). Tüm survey'ler geçici bir dosyaya
// yeniden derlenir ve repodaki çıktıyla karşılaştırılır.
describe('facades.json güncel', () => {
  it('survey dosyalarından yeniden derleme repodaki facades.json ile aynı', () => {
    const root = join(__dirname, '../..');
    const repo = join(root, 'src/worlds/measured/data/facades.json');
    const dir = mkdtempSync(join(tmpdir(), 'fresh-'));
    const out = join(dir, 'facades.json');
    copyFileSync(repo, out);
    execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/survey-compile.mjs'], {
      cwd: root,
      env: { ...process.env, SURVEY_OUT: out },
      stdio: 'pipe',
    });
    const a = JSON.parse(readFileSync(repo, 'utf8'));
    const b = JSON.parse(readFileSync(out, 'utf8'));
    const A = a.buildings ?? a;
    const B = b.buildings ?? b;
    const stale = Object.keys(B).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
    expect(stale).toEqual([]);
  }, 120_000);
});
