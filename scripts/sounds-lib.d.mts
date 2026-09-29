// sounds-lib.mjs tip bildirimleri (birim testleri için)
export interface License {
  family: string;
  version: string;
}
export function parseLicense(s: string): License;
export const LICENSE_NAME: Record<string, string>;
export function licenseUrl(l: License): string;
export function parseFreesoundPage(
  html: string,
  finalUrl?: string,
): { preview: string | null; license: License | null; title: string | null; user: string | null };
export function decodeHtml(s: string): string;
export function parseFreesoundPack(html: string, user: string): { id: string; name: string }[];
export function rms(x: Float32Array, a?: number, b?: number): number;
export function peak(x: Float32Array, a?: number, b?: number): number;
export function loudestWindow(
  x: Float32Array,
  sr: number,
  winSec: number,
): { rms: number; at: number; center: number };
export function dbToLin(d: number): number;
export function linToDb(v: number): number;
export function highpass(x: Float32Array, sr: number, fc: number): Float32Array;
export function envelopeDb(x: Float32Array, sr: number, hopSec?: number): { env: Float32Array; hop: number };
export function detectEvents(
  x: Float32Array,
  sr: number,
  opts?: {
    minGap?: number;
    maxLen?: number;
    minLen?: number;
    relDb?: number;
    tailDb?: number;
    preRoll?: number;
    rise?: number;
  },
): { start: number; end: number }[];
export function prepareSlice(
  chans: Float32Array[],
  sr: number,
  start: number,
  end: number,
  opts?: { targetDb?: number; win?: number; fadeIn?: number; fadeOut?: number; ceiling?: number },
): Float32Array[];
export function packSprite(
  parts: { chans: Float32Array[]; tag?: string }[],
  sr: number,
  opts?: { lead?: number; gap?: number },
): { chans: Float32Array[]; slices: [number, number, string?][] };
export function makeLoop(chans: Float32Array[], sr: number, xfade?: number): Float32Array[];
export function normalize(
  chans: Float32Array[],
  targetDb?: number,
  ceiling?: number,
  sr?: number,
  win?: number,
): Float32Array[];
export function fade(chans: Float32Array[], sr: number, inSec: number, outSec: number): Float32Array[];
export function deinterleave(buf: Uint8Array, ch: number): Float32Array[];
export function interleave(chans: Float32Array[]): Float32Array;
