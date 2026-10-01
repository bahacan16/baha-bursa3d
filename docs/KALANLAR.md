# Kalan işler (2026-10-01, eleştirmen döngüsü durduruldu)

Kullanıcı kararıyla D4 eleştirmen döngüsü 3. turdan sonra durduruldu. Aşağıdakiler bilinen, yapılmamış farklar.
Ayrıntılı ölçümler: eleştirmen raporları (oturum dışı) ve ilgili survey `note` / `pending` alanları.

## Yüksek öncelik

- **Zemin kotu, 1550614219 (KuveytTürk) bulvar / 331. Sk. tarafı (x 655–680, z −520…−428):** oyun arazisi ölçülen
  kaldırımdan ≈1.6–1.9 m alçak → vitrin camının altında ≈2 m boş duvar. Sokak tarafı fotoğrafta asfaltla aynı hizada
  → arazi (terrain.bin) yerel düzeltmesi gerekiyor; 1546358573 (Biaport) da benzer olabilir.
- **1477364957 doğu yüzü (ring kenarı 2):** ölçülmedi, 9 kat düz sıva (c15). Yalnız çok eğik kare var (sd8u 180) —
  yeni Street View karesi gerekir.
- **1551828357 kuzey yüzü (c7):** boş 4.7 m duvar; fotoğrafta orada açık sokak → taban izi kuzey kenarı kontrol.

## Orta

- Hasköyüm/yataş kapalı terası (1546358573 önü): derinlik kaynakları çelişiyor (hava 3.5 m ama duvardan 4 m önde) →
  duvar z yeniden ölçülmeli.
- Coffeemania kış bahçesi: 1551828357 köşesinin ortofotosu gerekli.
- Ceylan kuzey (1551814323 e0) girinti tavanı açık gri bant gibi; fotoğrafta koyu → `ceil` rengi ya da açık set-back.
- Toleran SİGORTA panosunu kesen tan çatı alnı (1550614219 e0, ≈8.1–8.5 m).
- 1550614219 sol kule yüzü (b1): her katta pencere/balkon görülüyor ama ölçülebilir kare yok.
- Logolar / ikonlar: BOĞA boğa başı, ARMILLA kırmızı haç, Ptt boru, Watsons W deseni, KuveytTürk palmiye.
- c12 yaya geçidi hâlâ parlak/kırık görünüyor (fade verisi var, OSM zebrası bastırıldı; başka bir geçit olabilir).
- Asfalt rengi oyunda ≈5 b* soğuk (güneş ve gölgede) — `roads.ts` asfalt albedosu.
- Zemin gök görüşü (`env/skyvis.ts`) hazır ama varsayılan kapalı (`?skyvis=1`): Ultra gerçek GPU'da ölçülmeli.

## Kod (üretici)

- `canopy` için çatılı çadır bölmeleri (OUTLET CITY), yıkanmış çakıllı beton zemin dokusu, bağımsız sütun öğesi,
  çatı terası saksı nesnesi, harf dış çizgisi (`outlineW` var; Cadı'nın Evi verisi eklenmedi), ac-cage paletleri.
