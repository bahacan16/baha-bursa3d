import * as THREE from 'three';
import { db, playSlice, type SoundCore } from './core';
import { footProfile, pickBank, type FootSurface } from './surfaces';
import { synthStep } from './procedural';
import type { AudioHost } from './types';

/**
 * Oyuncu ayak sesleri: zemine göre kayıt bankası, çok sayıda rastgele varyasyon (tekrarsız seçim, perde ±%5,
 * düzey ±2 dB), sol/sağ ayak konumundan HRTF. Zamanlama:
 * - 3. şahıs: iskeletteki ayak kemiklerinin yere basma anı (kemik yüksekliği yerel minimuma inince) — görülen
 *   animasyonla birebir.
 * - 1. şahıs / iskelet yoksa: kameranın adım evresi (baş salınımıyla aynı topuk vuruşu).
 * Zıplama inişinde iki ayak birden (daha ağır) iniş sesi.
 */
export class Footsteps {
  private bones: { l: THREE.Object3D | null; r: THREE.Object3D | null; root: THREE.Object3D | null } = {
    l: null,
    r: null,
    root: null,
  };
  private foot = [
    { h: 0, min: 1, max: 0, down: true, vel: 0 },
    { h: 0, min: 1, max: 0, down: true, vel: 0 },
  ];
  private lastStep = 0;
  private lastPhase = NaN;
  private air = 0;
  private wasGround = true;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private searchTimer = 0;
  private leftNext = true;
  /** Son basılan zemin (hata ayıklama) */
  surface: FootSurface = 'pavers';

  constructor(private readonly core: SoundCore) {}

  private findBones(root: THREE.Object3D): void {
    let l: THREE.Object3D | null = null;
    let r: THREE.Object3D | null = null;
    root.traverse((o) => {
      const n = o.name;
      // readyplayer.me: LeftFoot; Mixamo: mixamorigLeftFoot; RobotExpressive: FootL (glTF'de "Foot.L")
      if (!l && /^(mixamorig:?)?LeftFoot$|^Foot\.?L$/.test(n)) l = o;
      if (!r && /^(mixamorig:?)?RightFoot$|^Foot\.?R$/.test(n)) r = o;
    });
    this.bones = { l, r, root };
  }

  update(dt: number, host: AudioHost, bank: (s: string) => boolean): void {
    const c = host.controller;
    const speed = Math.hypot(c.velocity.x, c.velocity.z);
    const onGround = c.onGround && !c.frozen && !host.photoMode;
    const now = this.core.ctx.currentTime;
    // İniş
    if (!onGround && !c.frozen) this.air += dt;
    if (onGround && !this.wasGround && this.air > 0.28) this.land(host, Math.min(1, this.air / 0.8), bank);
    if (onGround) this.air = 0;
    this.wasGround = onGround;
    if (!onGround || speed < 0.3) {
      this.lastPhase = NaN;
      for (const f of this.foot) f.down = true;
      return;
    }
    const root = host.character.root;
    const useBones = !host.follow.firstPerson && root.visible;
    if (useBones) {
      if (this.bones.root !== root || (!this.bones.l && (this.searchTimer -= dt) <= 0)) {
        this.searchTimer = 1;
        this.findBones(root);
      }
    }
    const L = this.bones.l;
    const R = this.bones.r;
    if (useBones && L && R) {
      // Kemik yüksekliği (kök kotuna göre); uyarlanır min/max ile %30 eşik, histerezisli
      const baseY = root.getWorldPosition(this.tmp2).y;
      const fs = [L, R];
      for (let i = 0; i < 2; i++) {
        const f = this.foot[i];
        const y = fs[i].getWorldPosition(this.tmp).y - baseY;
        const vel = (y - f.h) / Math.max(1e-3, dt);
        f.h = y;
        f.vel = vel;
        f.min = Math.min(f.min + dt * 0.02, y);
        f.max = Math.max(f.max - dt * 0.05, y);
        const range = Math.max(0.03, f.max - f.min);
        const lo = f.min + range * 0.22;
        const hi = f.min + range * 0.5;
        if (f.down && y > hi) f.down = false;
        else if (!f.down && y < lo && vel <= 0.05) {
          f.down = true;
          if (now - this.lastStep > 0.16) {
            this.lastStep = now;
            fs[i].getWorldPosition(this.tmp);
            this.step(host, this.tmp.x, this.tmp.y, this.tmp.z, i === 0, speed, bank);
          }
        }
      }
      this.lastPhase = NaN;
      return;
    }
    // 1. şahıs: kamera adım evresi (tam sayı = topuk vuruşu); yoksa hızdan kadans
    let phase = host.follow.step;
    if (phase === undefined || !Number.isFinite(phase)) {
      const rate = speed < 3 ? 1.1 + speed * 0.45 : 2.6 + (speed - 3) * 0.12;
      phase = (Number.isFinite(this.lastPhase) ? this.lastPhase : 0) + rate * dt;
    }
    if (Number.isFinite(this.lastPhase) && Math.floor(phase) > Math.floor(this.lastPhase)) {
      const left = this.leftNext;
      this.leftNext = !left;
      // Ayak konumu: gövdeden 10 cm yana
      const h = c.heading;
      const rx = Math.cos(h);
      const rz = -Math.sin(h);
      const s = left ? -0.1 : 0.1;
      this.step(host, c.position.x + rx * s, c.position.y + 0.02, c.position.z + rz * s, left, speed, bank);
    }
    this.lastPhase = phase;
  }

  private surfaceAt(host: AudioHost, x: number, z: number): FootSurface {
    const scene = host.world?.soundScene?.() ?? null;
    return scene ? scene.surfaceAt(x, z) : 'pavers';
  }

  private step(
    host: AudioHost,
    x: number,
    y: number,
    z: number,
    left: boolean,
    speed: number,
    bank: (s: string) => boolean,
  ): void {
    const core = this.core;
    const surf = (this.surface = this.surfaceAt(host, x, z));
    const prof = footProfile(surf);
    const run = speed > 3.2;
    // KARAR: koşuda +4 dB, yürüyüşte hıza göre (1.6 m/s ≈ 0 dB)
    const loudDb = (run ? 4 : -2 + Math.min(2, speed)) + prof.gain + (core.rnd() * 4 - 2);
    const v = core.voice('steps', { hrtf: true, ref: 5, rolloff: 1, wet: 0.5 * prof.wet * this.wetFor() });
    v.place(x, y, z);
    const t = core.ctx.currentTime + 0.005;
    let chain: AudioNode = v.input;
    if (prof.lowpass > 0 || prof.bright !== 0) {
      const f = core.ctx.createBiquadFilter();
      if (prof.lowpass > 0) {
        f.type = 'lowpass';
        f.frequency.value = prof.lowpass;
      } else {
        f.type = 'highshelf';
        f.frequency.value = 4000;
        f.gain.value = prof.bright;
      }
      f.connect(v.input);
      chain = f;
    }
    const slot = pickBank(surf, bank);
    const s = slot ? core.bank.pickSlice(slot, run ? 'run' : 'walk', () => core.rnd()) : null;
    if (s) {
      const rate = prof.rate * (0.95 + core.rnd() * 0.1) * (run ? 1.03 : 1);
      playSlice(core, s, chain, t, rate, db(loudDb - 4));
    } else synthStep(core.ctx, core.noise, chain, t, prof.synth, db(loudDb), left);
    if (prof.ring) this.ring(chain, t, prof.ring, db(loudDb - 14));
    setTimeout(() => v.dispose(), 1500);
  }

  /** Rögar kapağı çınlaması: kısa rezonanslı bant geçiren darbe. */
  private ring(dest: AudioNode, t: number, f0: number, g0: number): void {
    const ctx = this.core.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.core.noise.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f0 * (0.9 + this.core.rnd() * 0.2);
    bp.Q.value = 18;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(g0 * 6, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, this.core.rnd() * 2, 0.4);
  }

  /** Kanyonda adımlar daha çok yankılanır. */
  private wetFor(): number {
    const a = this.core.acoustics;
    return a.kind === 'open' ? 0.35 : 0.6 + 0.6 * a.enclosure;
  }

  private land(host: AudioHost, strength: number, bank: (s: string) => boolean): void {
    const c = host.controller;
    const p = c.position;
    const speed = Math.hypot(c.velocity.x, c.velocity.z);
    // İki ayak ~25 ms arayla + alçak tok vuruş
    this.step(host, p.x - 0.1, p.y, p.z, true, 3.5 + strength * 2, bank);
    setTimeout(() => this.step(host, p.x + 0.1, p.y, p.z, false, 3.5 + strength * 2, bank), 25);
    const core = this.core;
    const v = core.voice('steps', { hrtf: true, ref: 5, wet: 0.3 });
    v.place(p.x, p.y, p.z);
    const t = core.ctx.currentTime + 0.01;
    const o = core.ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = core.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * strength * (speed > 3 ? 1.2 : 1), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(v.input);
    o.start(t);
    o.stop(t + 0.2);
    setTimeout(() => v.dispose(), 800);
  }
}
