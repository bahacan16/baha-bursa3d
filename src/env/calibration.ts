/**
 * Gündüz ışık kalibrasyonu tek yerde (Street View'a göre, 71 yama / 11 görüş — docs/BLENDER_CHANGES.md `1b160a8`):
 * ortam haritası ölçeği, yarım küre ışığı çarpanı, pozlama çarpanı, ekran uzayı AO (N8AO).
 *
 * İki küme var:
 * - `live`: canlı ışık (pişirme yok). Kalibrasyon bununla yapıldı: env 0.038, yarım küre ×0.6.
 * - `baked`: el modelinde pişirilmiş dolaylı ışık etkin (`bakedLighting.active`, docs/BAKE.md). Pişirilmiş oran
 *   yalnız dolaylı ışığı (ortam + yarım küre) çarpar; kalibrasyon AO'suz yapıldığı için gölgedeki cepheler ~%15–25
 *   koyulaşır → bu küme Street View yama setine göre yeniden oturtulmalı. Ekran uzayı AO pişirilmiş AO'nun üstüne
 *   ikinci kez karartmasın diye burada azaltılır (yalnız yakın temas ayrıntısı kalır).
 *
 * KARAR: `baked` env/yarım küre/pozlama şimdilik `live` ile aynı — tahmini bir telafi uydurulmadı; pişirme ajanı
 * yeniden oturtunca değerler buraya yazılır. Deneme: `?benv= ?bhemi= ?bexp= ?bssao= ?bssaor=` (mutlak değerler).
 */
export interface LightCalibration {
  /** scene.environmentIntensity (gökyüzü PMREM'i HDR çok parlak → düşük ölçek) */
  env: number;
  /** HemisphereLight şiddeti = daylight.hemiIntensity × hemi */
  hemi: number;
  /** renderer.toneMappingExposure = daylight.exposure × exposure */
  exposure: number;
  /** N8AO şiddeti ve yarıçapı (m) */
  ssao: number;
  ssaoRadius: number;
}

const params = () => new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

function num(q: URLSearchParams, key: string, def: number): number {
  const v = Number(q.get(key));
  return q.has(key) && Number.isFinite(v) ? v : def;
}

export function lightCalibration(baked: boolean): LightCalibration {
  const q = params();
  const live: LightCalibration = {
    env: num(q, 'env', 0.038),
    hemi: 0.6,
    exposure: 1,
    ssao: num(q, 'ao', 1.7),
    ssaoRadius: num(q, 'aor', 2.2),
  };
  if (!baked) return live;
  return {
    env: num(q, 'benv', live.env),
    hemi: num(q, 'bhemi', live.hemi),
    exposure: num(q, 'bexp', live.exposure),
    // pişirilmiş oran büyük ölçekli örtmeyi (balkon altı, avlu, bina arası) zaten taşıyor → N8AO yalnız temas
    ssao: num(q, 'bssao', 0.9),
    ssaoRadius: num(q, 'bssaor', 1.0),
  };
}
