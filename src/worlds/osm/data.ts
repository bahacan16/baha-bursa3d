import {
  CENTER_STREET,
  DATA_HALF,
  DEFAULT_CENTER_LITE,
  OVERPASS_ENDPOINTS,
  centerQuery,
  dataQuery,
  simplifyOverpass,
  streetMidpoint,
  type OverpassJson,
  type SimpleOsm,
} from './simplify';

export class DataError extends Error {}

export type LoadProgress = (fraction: number, label: string) => void;

async function fetchWithProgress(url: string, onProgress: LoadProgress, label: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new DataError(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total), label);
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}

async function overpassBrowser(query: string): Promise<OverpassJson> {
  let last: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OverpassJson;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function isSimpleOsm(v: unknown): v is SimpleOsm {
  const o = v as SimpleOsm;
  return !!o && o.version === 1 && Array.isArray(o.ways) && Array.isArray(o.nodes) && !!o.center;
}

/**
 * public/data/osm.json yükler; yoksa tarayıcıdan Overpass'a sorar (CORS açık).
 * İkisi de başarısızsa DataError fırlatır.
 */
export async function loadOsmData(base: string, onProgress: LoadProgress): Promise<SimpleOsm> {
  try {
    const text = await fetchWithProgress(
      `${base}data/osm.json`,
      (f) => onProgress(f * 0.9, 'Harita verisi indiriliyor'),
      '',
    );
    const json = JSON.parse(text) as unknown;
    if (isSimpleOsm(json)) return json;
    throw new DataError('osm.json biçimi geçersiz');
  } catch (err) {
    console.warn('osm.json yüklenemedi, Overpass deneniyor:', (err as Error).message);
  }
  onProgress(0.05, 'OpenStreetMap (Overpass) sorgulanıyor…');
  try {
    let center = DEFAULT_CENTER_LITE;
    let source = 'default';
    try {
      const q = await overpassBrowser(centerQuery(DEFAULT_CENTER_LITE));
      const mid = streetMidpoint(q, DEFAULT_CENTER_LITE, CENTER_STREET);
      if (mid) {
        center = mid;
        source = `osm:${CENTER_STREET}`;
      } else console.warn(`${CENTER_STREET} bulunamadı; varsayılan merkez kullanılıyor.`);
    } catch {
      /* merkez sorgusu başarısızsa varsayılan merkez */
    }
    onProgress(0.3, 'OpenStreetMap verisi indiriliyor (bu biraz sürebilir)…');
    const raw = await overpassBrowser(dataQuery(center, DATA_HALF));
    onProgress(0.9, 'Veri sadeleştiriliyor');
    return simplifyOverpass(raw, center, source, DATA_HALF);
  } catch (err) {
    throw new DataError(
      `Harita verisi bulunamadı. public/data/osm.json yok ve Overpass API'ye ulaşılamadı (${(err as Error).message ?? err}).`,
    );
  }
}
