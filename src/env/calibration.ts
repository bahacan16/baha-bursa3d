/**
 * Gündüz ışık kalibrasyonu tek yerde: ortam haritası ölçeği, yarım küre ışığı çarpanı, pozlama çarpanı, ekran uzayı
 * AO (N8AO). Gölge rengi (renk ayarı gölge tonu) `post.ts` GradeShader'da.
 *
 * İki küme var:
 * - `live`: canlı ışık (pişirme yok).
 * - `baked`: el modelinde pişirilmiş dolaylı ışık etkin (`bakedLighting.active`, docs/BAKE.md). Pişirilmiş oran
 *   yalnız dolaylı ışığı (ortam + yarım küre) çarpar → bu küme pişirme varken Street View yama setine göre yeniden
 *   oturtulmalı. Ekran uzayı AO pişirilmiş AO'nun üstüne ikinci kez karartmasın diye burada azaltılır.
 *
 * Kalibrasyon geçmişi:
 * 1. `1b160a8`: 71 yama / 11 görüş, görüş başına serbest pozlama → env 0.038, yarım küre ×0.6. N8AO (1.7 / 2.2 m)
 *    o sırada da açıktı (git: 7413087). Not: 11 görüşün 7'si (Doğan Avcıoğlu, 0–6) BULUTLU çekim; güneş/gölge
 *    oranı yalnız 2 güneşli çiftten ölçülmüştü.
 * 2. 2026-09-30 (yeniden ölçüm, yalnız GÜNEŞLİ kareler, Mertkent-2 çevresi, 2025-09): bileşen yakalaması (güneş /
 *    yarım küre gök+zemin / ortam gök+zemin / sabit, AO ayrı çarpan, ton eşleme öncesi HDR) + çevrimdışı hat.
 *    Yüksek kalite, mevcut değerlerle:
 *    - güneşli/gölgeli aynı kilit taşı (kuzey kapı + 95 blok): oyun oranı fotoğraftan 0.20 / 0.65 durak DÜŞÜK →
 *      zemin gölgesi fazla aydınlık (gölgedeki zeminin %72'si yarım küre ışığı);
 *    - açık cephe gölgesi (96 K, 95 K, 44 B, 44/45 KKB): mutlak sRGB fotoğrafla ±0.3 durak, ortalama +0.01 →
 *      KARANLIK DEĞİL (eleştirmenlerin %30–45 karanlık bulgusu bulutlu Doğan Avcıoğlu karelerinden: geçersiz);
 *    - içbükey gölge (site duvarı çit altı, kolon): güneşli zemine göre 0.35 durak koyu; AO^1.7 bu yüzeylerde 0.69
 *      (N8AO doğrudan güneşi de çarpar) → AO fazla;
 *    - gölge rengi: nötr yüzeylerde b* +3.8 (oyun sarı), fotoğrafta gölge mavi (ör. #3e4950 vs oyun #484d50).
 *    Yeni değerler: yarım küre ×0.6→×0.45, pozlama ×1.08 (açık cephe gölgesi mutlak düzeyde kalsın), N8AO 1.7→1.2,
 *    yarıçap 2.2→1.6 m, gölge tonu soğuk (post.ts). Sonuç: zemin çifti −0.42→−0.22 durak, içbükey −0.35→−0.17,
 *    nötr ΔE(a*b*) 4.6→3.2, b* +3.8→+1.9, açık cephe mutlak +0.01→+0.03. Ortam ölçeği (0.038) değişmedi: açık
 *    cephelerin ~%60'ı ortam haritasının zemin/siluet bandından; veri düşürmeyi de artırmayı da desteklemiyor.
 *    Ultra (göz uyumu kapalı `?noae`) Yüksek ile aynı çıktı (±0.05 durak); Ultra'ya özgü tek fark göz uyumu →
 *    `post.ts` ULTRA_EXPOSURE_REF −1.48 → −1.60 (güneşli karelerin ölçer ortalaması).
 *    Araçlar: kalibrasyon ajanının çalışma alanı `scratchpad/recal/` (cap.mjs bileşen yakalama, model.mjs yeniden
 *    kurulum, cls.mjs ölçütler); yama seti `p_all.json` (7 görüş, 25 yama; 10'u cam/bitki/doğu cephesi,
 *    yalnız rapor).
 *
 * KARAR: `baked` env/yarım küre/pozlama `live` ile aynı — tahmini bir telafi uydurulmadı; pişirme ajanı yeniden
 * oturtunca değerler buraya yazılır. Deneme: canlı `?env= ?hemi= ?lexp= ?ao= ?aor=`, pişirilmiş `?benv= ?bhemi=
 * ?bexp= ?bssao= ?bssaor=` (mutlak değerler).
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
    // KARAR: 0.6 → 0.45 (güneşli kilit taşı güneş/gölge çifti; bkz. yukarı, 2026-09-30)
    hemi: num(q, 'hemi', 0.45),
    // KARAR: 1 → 1.08 (yarım küre azalınca açık cephe gölgesi Street View mutlak düzeyinde kalsın)
    exposure: num(q, 'lexp', 1.08),
    // KARAR: 1.7 / 2.2 m → 1.2 / 1.6 m (çit altı / kolon gibi içbükey gölgeler 0.35 durak koyuydu)
    ssao: num(q, 'ao', 1.2),
    ssaoRadius: num(q, 'aor', 1.6),
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
