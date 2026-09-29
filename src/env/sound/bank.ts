/**
 * Kayıt bankası: `public/sounds/manifest.json` (scripts/fetch-sounds.mjs üretir, Actions'ta) + MP3 dosyaları.
 * Dosyalar yoksa her yuva boş döner ve motor prosedürel sese düşer. Kısa dosyalar AudioBuffer'a çözülür, uzun
 * kayıtlar (ezan) HTMLAudioElement ile akıtılır (bellek: 4 dk stereo ≈ 85 MB PCM olurdu).
 */

/** Manifest şeması — scripts/fetch-sounds.mjs ile aynı. */
export interface ManifestFile {
  file: string;
  /** saniye */
  dur: number;
  ch: number;
  /** Tek tek olaylar (adım, kuş ötüşü, korna…): [başlangıç, süre, etiket?] */
  slices?: [number, number, string?][];
  /** Döngü (kesintisiz, uçları çapraz geçişli) */
  loop?: boolean;
  /** Olay dosyasında en yüksek zarf anı (s) — geçiş (pass-by) hizalaması */
  peak?: number;
  /** Kaynak kimliği (fs:123, bsb:0510 …) */
  src: string;
  /** Kayıt yeri (ör. "TR-Istanbul") */
  region?: string;
  tags?: string[];
}

export interface ManifestSlot {
  kind: 'steps' | 'calls' | 'loop' | 'long' | 'event';
  files: ManifestFile[];
}

export interface Manifest {
  version: number;
  generated: string;
  slots: Record<string, ManifestSlot>;
}

export interface Slice {
  buf: AudioBuffer;
  start: number;
  dur: number;
  tag?: string;
}

/** Tampon uçlarındaki kod çözücü sessizliğini (MP3/AAC gecikmesi) atla: döngü noktaları. */
export function trimSilence(buf: AudioBuffer, thr = 1e-4): { start: number; end: number } {
  const d = buf.getChannelData(0);
  const n = d.length;
  const W = 32;
  let a = 0;
  outer: for (let i = 0; i < n; i += W) {
    for (let j = i; j < Math.min(n, i + W); j++)
      if (Math.abs(d[j]) > thr) {
        a = i;
        break outer;
      }
  }
  let b = n;
  outer2: for (let i = n - 1; i >= 0; i -= W) {
    for (let j = i; j > Math.max(-1, i - W); j--)
      if (Math.abs(d[j]) > thr) {
        b = i + 1;
        break outer2;
      }
  }
  if (b - a < buf.sampleRate * 0.5) return { start: 0, end: buf.duration };
  return { start: a / buf.sampleRate, end: b / buf.sampleRate };
}

export class SampleBank {
  private manifest: Manifest | null = null;
  private buffers = new Map<string, AudioBuffer | null>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private loops = new Map<AudioBuffer, { start: number; end: number }>();
  private lastPick = new Map<string, number[]>();
  ready: Promise<void>;
  /** Yüklenen dosya sayısı (hata ayıklama) */
  loaded = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly base: string,
  ) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    try {
      const r = await fetch(`${this.base}sounds/manifest.json`, { cache: 'no-cache' });
      if (!r.ok) return;
      const m = (await r.json()) as Manifest;
      if (m && m.slots && typeof m.slots === 'object') this.manifest = m;
    } catch {
      /* dosya yok → prosedürel */
    }
  }

  get available(): boolean {
    return !!this.manifest;
  }

  has(slot: string): boolean {
    return !!this.manifest?.slots[slot]?.files.length;
  }

  slot(slot: string): ManifestSlot | null {
    return this.manifest?.slots[slot] ?? null;
  }

  url(f: ManifestFile): string {
    return `${this.base}sounds/${f.file}`;
  }

  /** Çözülmüş tampon; hazır değilse null döner ve yüklemeyi başlatır. */
  buffer(slot: string, i = 0): AudioBuffer | null {
    const f = this.manifest?.slots[slot]?.files[i];
    if (!f) return null;
    const key = f.file;
    const b = this.buffers.get(key);
    if (b !== undefined) return b;
    if (!this.pending.has(key)) this.pending.set(key, this.decode(key, this.url(f)));
    return null;
  }

  /** Yuvanın tüm dosyalarını önceden yükle. */
  preload(slots: readonly string[]): Promise<unknown> {
    const ps: Promise<unknown>[] = [];
    for (const s of slots) {
      const files = this.manifest?.slots[s]?.files ?? [];
      files.forEach((f, i) => {
        this.buffer(s, i);
        const p = this.pending.get(f.file);
        if (p) ps.push(p);
      });
    }
    return Promise.all(ps);
  }

  private async decode(key: string, url: string): Promise<AudioBuffer | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.arrayBuffer();
      const buf = await new Promise<AudioBuffer>((res, rej) => {
        // Eski Safari: geri çağırmalı imza
        const p = this.ctx.decodeAudioData(data, res, rej);
        if (p && typeof (p as Promise<AudioBuffer>).then === 'function')
          (p as Promise<AudioBuffer>).then(res, rej);
      });
      this.buffers.set(key, buf);
      this.loaded++;
      return buf;
    } catch (e) {
      console.warn('Ses dosyası çözülemedi', url, e);
      this.buffers.set(key, null);
      return null;
    }
  }

  /** Döngü noktaları (kod çözücü sessizliği atlanmış). */
  loopPoints(buf: AudioBuffer): { start: number; end: number } {
    let lp = this.loops.get(buf);
    if (!lp) this.loops.set(buf, (lp = trimSilence(buf)));
    return lp;
  }

  /**
   * Rastgele dilim (son `avoid` seçimi tekrar etmeden). `tag` verilirse önce o etiketliler (ör. 'run').
   * Yuvanın tüm dosyalarındaki dilimler havuzdur; hazır olmayan dosya atlanır.
   */
  pickSlice(slot: string, tag?: string, rnd: () => number = Math.random, avoid = 3): Slice | null {
    const s = this.manifest?.slots[slot];
    if (!s) return null;
    const pool: { f: number; k: number }[] = [];
    const tagged: { f: number; k: number }[] = [];
    s.files.forEach((f, fi) => {
      const buf = this.buffer(slot, fi);
      if (!buf) return;
      const sl = f.slices;
      if (!sl || !sl.length) {
        pool.push({ f: fi, k: -1 });
        return;
      }
      sl.forEach((x, k) => {
        pool.push({ f: fi, k });
        if (tag && x[2] === tag) tagged.push({ f: fi, k });
      });
    });
    const src = tagged.length >= 3 ? tagged : pool;
    if (!src.length) return null;
    const hist = this.lastPick.get(slot) ?? [];
    let pick = src[Math.floor(rnd() * src.length)];
    for (let tries = 0; tries < 6 && src.length > avoid; tries++) {
      const id = pick.f * 10000 + pick.k;
      if (!hist.includes(id)) break;
      pick = src[Math.floor(rnd() * src.length)];
    }
    hist.push(pick.f * 10000 + pick.k);
    while (hist.length > Math.min(avoid, src.length - 1)) hist.shift();
    this.lastPick.set(slot, hist);
    const f = s.files[pick.f];
    const buf = this.buffers.get(f.file)!;
    if (pick.k < 0) return { buf, start: 0, dur: buf.duration };
    const [start, dur, t] = f.slices![pick.k];
    return { buf, start, dur, tag: t };
  }

  /** Uzun kayıt için akış öğesi (ezan). */
  media(slot: string, i = 0): HTMLAudioElement | null {
    const f = this.manifest?.slots[slot]?.files[i];
    if (!f || typeof Audio === 'undefined') return null;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = this.url(f);
    return el;
  }

  fileInfo(slot: string, i = 0): ManifestFile | null {
    return this.manifest?.slots[slot]?.files[i] ?? null;
  }

  fileCount(slot: string): number {
    return this.manifest?.slots[slot]?.files.length ?? 0;
  }
}
