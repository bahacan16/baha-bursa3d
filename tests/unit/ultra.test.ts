import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { installUltraChunks, patchSkyClouds } from '../../src/env/ultra';

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
  });

  it('moves Sky clouds onto the shared world-space cloud field', () => {
    const sky = new Sky();
    expect(patchSkyClouds(sky.material)).toBe(true);
    expect(sky.material.fragmentShader).toContain('ucField( cloudXZ');
    expect(sky.material.fragmentShader).not.toContain('cloudUV * 1000.0');
  });
});
