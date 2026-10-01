import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { horizonVisibility, patchSkyVis, skyVisParams } from '../../src/env/skyvis';

describe('ground sky visibility (env/skyvis.ts)', () => {
  it('open ground sees the whole sky', () => {
    expect(horizonVisibility(() => 0, 0, 0.45)).toBeCloseTo(1, 6);
  });

  it('a 3 m wall 0.5 m away hides roughly half of the cosine-weighted sky', () => {
    // duvar +x yönünde, x ≥ 0.5, yükseklik 3 m (Mertkent site duvarı + çit dibi)
    const v = horizonVisibility((dx) => (dx >= 0.5 ? 3 : 0), 0, 0.45);
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.7);
  });

  it('a street canyon is darker than a single wall, a far building barely matters', () => {
    const one = horizonVisibility((dx) => (dx >= 4 ? 20 : 0), 0, 0.45);
    const two = horizonVisibility((dx) => (Math.abs(dx) >= 4 ? 20 : 0), 0, 0.45);
    const far = horizonVisibility((dx) => (dx >= 40 ? 20 : 0), 0, 0.45);
    expect(two).toBeLessThan(one);
    expect(far).toBeGreaterThan(0.95);
  });

  it('covered ground (eave / shelter above) returns the covered value; small kerbs barely occlude', () => {
    expect(horizonVisibility((dx, dz) => (Math.hypot(dx, dz) < 1 ? 3 : 0), 0, 0.45)).toBe(0.45);
    expect(horizonVisibility((dx) => (dx >= 0.4 ? 0.15 : 0), 0, 0.45)).toBeGreaterThan(0.97);
  });

  it('calibration defaults: open shade ×1.35, wall foot darker than before', () => {
    const p = skyVisParams();
    expect(p.k * p.open).toBeCloseTo(1.35, 2);
    const wall = horizonVisibility((dx) => (dx >= 0.5 ? 3 : 0), 0, p.covered);
    expect(p.k * wall).toBeLessThan(1);
  });

  it('patches lit materials once, only indirect light, chaining cache keys', () => {
    const m = new THREE.MeshStandardMaterial();
    const baseKey = m.customProgramCacheKey();
    expect(patchSkyVis(m)).toBe(true);
    expect(patchSkyVis(m)).toBe(false);
    expect(m.customProgramCacheKey()).toBe(`${baseKey}|skyvis`);
    const sh = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    expect(sh.fragmentShader).toContain('skyVisFactor');
    expect(sh.fragmentShader).toContain('reflectedLight.indirectDiffuse *= skyF');
    expect(sh.fragmentShader).not.toContain('reflectedLight.directDiffuse *= skyF');
    expect(sh.vertexShader).toContain('vSkyWp');
    expect(sh.uniforms.uSkyH).toBeDefined();
    // ikinci kez çalışırsa (klon onBeforeCompile'ı kopyalamış) çift ekleme yok
    const once = sh.fragmentShader;
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    expect(sh.fragmentShader).toBe(once);
    // ışıksız malzeme yamalanmaz
    expect(patchSkyVis(new THREE.MeshBasicMaterial())).toBe(false);
  });
});
