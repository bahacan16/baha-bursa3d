/** Google Photorealistic 3D Tiles atıfları: logo + tile'lardan toplanan telif metinleri (ekranda sürekli). */
export interface AttributionSource {
  getAttributions(target: { type: string; value: unknown }[]): { type: string; value: unknown }[];
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function googleAttributionHtml(tiles: AttributionSource): string {
  const list = tiles.getAttributions([]);
  const texts = list.filter((a) => a.type === 'string' && a.value).map((a) => String(a.value));
  const copyright = texts.join('; ');
  // KARAR: Resmî logo görseli paketlenmedi (marka dosyası); "Google" yazı logosu kullanılıyor.
  // Yayından önce güncel Map Tiles API Policies sayfasına göre logo gerekliliği kontrol edilmeli.
  return (
    `<span class="google-logo" aria-label="Google">Google</span>` +
    `<span>${esc(copyright || 'Google')}</span>` +
    `<span>· © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></span>`
  );
}
