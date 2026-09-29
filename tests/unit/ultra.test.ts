import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { installUltraChunks, patchSkyClouds } from '../../src/env/ultra';
import { TAAPass } from '../../src/env/taa';

// three sürümü değişince Ultra gölgelendirici yamalarının sessizce boşa düşmesini yakala
describe('Ultra shader patches', () => {
  it('replaces the sun shadow call with PCSS + cloud shadow and installs height haze', () => {
    const C = THREE.ShaderChunk as unknown as Record<string, string>;
    expect(C.lights_fragment_begin).toContain('getSunShadow( sunShadowMap[ i ], sunLightShadow');
    installUltraChunks();
    expect(C.lights_fragment_begin).toContain('getSunShadowUltra( sunShadowMap[ i ]');
    expect(C.shadowmask_pars_fragment).toContain('getSunShadowUltra');
    expect(C.shadowmap_pars_fragment).toContain('float ultraPCSS(');
    expect(C.fog_fragment).toContain('exp( - od )');
    expect(C.fog_vertex).toContain('vHazeY');
    // NaN/Inf güvenlik ağı (yarım kayan nokta taşması zamansal tamponları kalıcı bozmasın)
    expect(C.opaque_fragment).toContain('isnan( ultraOut )');
  });

  it('moves Sky clouds onto the shared world-space cloud field and clamps the sun disc', () => {
    const sky = new Sky();
    expect(patchSkyClouds(sky.material)).toBe(true);
    expect(sky.material.fragmentShader).toContain('ucField( cloudXZ');
    expect(sky.material.fragmentShader).not.toContain('cloudUV * 1000.0');
    expect(sky.material.fragmentShader).toContain('clamp( texColor, 0.0, 30000.0 )');
  });
});

describe('TAA camera cuts', () => {
  const setup = () => {
    const cam = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
    cam.position.set(0, 2, 0);
    cam.updateMatrixWorld();
    const taa = new TAAPass(cam, () => null, 8, 8);
    taa.jitter(8, 8);
    taa.unjitter();
    taa.reset = false;
    return { cam, taa };
  };

  it('keeps history for normal walking and small turns', () => {
    const { cam, taa } = setup();
    cam.position.x += 0.1;
    cam.rotateY(0.05);
    taa.jitter(8, 8);
    taa.unjitter();
    expect(taa.reset).toBe(false);
  });

  it('resets history on teleport, large rotation (e.g. top-down view) and fov change', () => {
    for (const cut of [
      (c: THREE.PerspectiveCamera) => c.position.set(40, 45, 0),
      (c: THREE.PerspectiveCamera) => c.rotateX(-Math.PI / 2),
      (c: THREE.PerspectiveCamera) => (c.fov = 90),
    ]) {
      const { cam, taa } = setup();
      cut(cam);
      taa.jitter(8, 8);
      taa.unjitter();
      expect(taa.reset).toBe(true);
    }
  });

  it('restores the exact projection after jittering', () => {
    const { cam, taa } = setup();
    const before = cam.projectionMatrix.clone();
    taa.jitter(8, 8);
    expect(cam.projectionMatrix.equals(before)).toBe(false);
    taa.unjitter();
    for (let i = 0; i < 16; i++) expect(cam.projectionMatrix.elements[i]).toBeCloseTo(before.elements[i], 12);
  });
});
