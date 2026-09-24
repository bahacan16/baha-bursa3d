import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';
import type { Quality } from '../core/settings';

/**
 * Son işleme: sahne HDR hedefe çizilir → N8AO (ortam gölgelemesi) → Bloom (gece ışıkları) → SMAA → ton eşleme.
 * KARAR: Düşük kalitede kapalı (mobil); Orta'da AO yarım çözünürlük.
 */
export class PostFX {
  readonly composer: EffectComposer;
  readonly ao: N8AOPass;
  readonly bloom: UnrealBloomPass;
  private smaa: SMAAPass;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: Quality,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.ao = new N8AOPass(scene, camera, size.x, size.y);
    const c = this.ao.configuration;
    c.autoRenderBeauty = false; // sahneyi (arka plan dahil) biz çiziyoruz
    c.gammaCorrection = false; // OutputPass yapıyor
    c.aoRadius = 2.2;
    c.distanceFalloff = 1.2;
    c.intensity = 2.6;
    c.halfRes = quality !== 'high';
    this.ao.setQualityMode(quality === 'high' ? 'Medium' : 'Low');
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
    this.composer.addPass(new OutputPass());
  }

  /** Güzel (beauty) hedefi: Game bu hedefe arka plan + sahneyi çizer. */
  get target(): THREE.WebGLRenderTarget {
    return this.ao.beautyRenderTarget as THREE.WebGLRenderTarget;
  }

  setNight(n: number): void {
    // KARAR: gündüz bloom kapalı — HDR gökyüzü eşiği aşıp ağaç/bina silüetlerine mavi bir perde yayıyordu.
    this.bloom.enabled = n > 0.15;
    this.bloom.strength = 0.12 + 0.55 * n;
    this.bloom.threshold = n > 0.5 ? 0.6 : 0.9;
  }

  setSize(w: number, h: number): void {
    const dpr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.ao.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
