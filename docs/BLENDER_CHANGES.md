# Blender değişiklik günlüğü (bulut oturumu → yerel Blender oturumu)

> Bulut oturumu her commit'te buraya bir satır ekler: ne değişti, hangi dosyalar, Blender'da hangi katman
> yeniden kurulmalı. Yerel oturum: `git pull` → bu dosyada son eşitlediğin commit'ten sonraki girdileri uygula →
> `blender/SYNC.md`'ye son uyguladığın commit'i yaz. Genel kurallar ve port haritası: `docs/BLENDER.md`.
>
> Katman adları `docs/BLENDER.md` §6 koleksiyonlarıdır. "Blender: —" = Blender'ı etkilemez.

## 2026-09-29

- **c9bb320** 07:02 — Site içi renk ayarı: kemik kilit taşı sıcak gri `#9d968e…`, kauçuk karo `#6a4f4b…`,
  havuz camı daha saydam (renk `#b4d2c8`, opaklık 0.42). Dosyalar: `src/worlds/mertkent/index.ts` (materials).
  **Blender:** `materials.py` → `spSiteGrey`, `rubberTile`, `glassFrost`; `NW/Mertkent/Site` malzemeleri.
- **8c6d3bd** 07:19 — Giriş ekranı sadeleşti (Mod A/anahtar kutusu kalktı). **Blender:** —
- **d168f16 / 62d71fd** 07:32 — Street View çekim aracı + yeni kareler (Uğur Mumcu, 503. Sk.). **Blender:** — (yalnız
  referans görüntü; karşılaştırma kameraları için kullanılabilir)
- **aadeafc** 07:57 — Işık ve kaldırım tonları:
  - Ortam haritasına ufuktan ~14°'ye kadar sıcak gri "şehir silueti" bandı; gök ışığı daha nötr (`hemiSky` gündüz
    `#dde4ec`). Gölgeler artık mavi değil nötr gri. Dosyalar: `src/game.ts`, `src/env/daylight.ts`.
    **Blender:** Dünya/gökyüzü: gölgede mavi baskın olmasın (Nishita + hafif gri ufuk, ya da gölge renginde nötr).
  - Asfalt köşe rengi sıcak gri `[0.27, 0.26, 0.245]` (`src/worlds/osm/roads.ts`). **Blender:** `materials.py` asfalt.
  - Kılavuz karo `#a8894a` (daha az doygun hardal), bisiklet yolu `#56758f`, kırmızı kilit taşı
    `#938882…` (gri-kiremit). Dosyalar: `facadeMats.ts`, `index.ts`, `osm/materials.ts`.
    **Blender:** `materials.py` → `tactile`, `spBike`, `spPaverRed`, genel kaldırım dokusu.
  - Doğan Avcıoğlu güney kaldırımında (Mertkent kuzeyi, `north-south-side`) bordür boyunca 1.3 m kırmızı bant geri
    geldi (Street View zemin karelerinde görülüyor); 502. Sk. yalnız gri + sarı + mavi. Cavit Orhan park cebi
    kırmızı. Dosya: `street.ts` `layoutOf`. **Blender:** `NW/Mertkent/Street`.
  - Ölçülmüş sokak bantlarında OSM yaya/bisiklet yolu çizgisi çizilmez; OSM bisiklet yolları mavi
    `[0.16, 0.26, 0.38]`. Dosya: `osm/roads.ts`. **Blender:** `NW/Roads`.
- **e1ca8a5 / bb393f8 / 2a55964 / d4d0d85** 07:59–08:00 — Doğan Avcıoğlu 2. bölüm için yakın plan kareler + hava
  fotoğrafı doğuya genişledi (`streetview-src/aerial/index.json`: cx 90, cz −140, half 250, 0.0833 m/px).
  **Blender:** hava fotoğrafı dokusu kullanılıyorsa yeni kapsam/çözünürlük.
- **907b285** 08:04 — Ölçüm şeması: pencere sütununda kat başına perde türü `curt` (tul, tul-yan, stor, jaluzi,
  zebra, karanlik, acik) ve panjur kapanma `shut`; `facades.json` → `win.curt` / `win.shut`. Dosyalar:
  `survey/schema.ts`, `scripts/survey-compile.mjs`, `facade.ts`.
  **Blender:** `mk_facade.py` pencere camı arkası: ölçülen perde türünü kullan (yoksa eskisi gibi tohumlu rastgele).
- **bbd9176** 08:31 — Yeni taban izleri: 1546358554, 1540901772, 1540901794, 1540901773
  (`src/worlds/mertkent/data/footprints.json`). **Blender:** bu 4 bina için OSM genel bina yerine ölçülmüş bina
  kurulacak (cephe ölçümleri geldikçe, aşağıya bak).
- **2585ed9** 08:32 — Karşılaştırma kameraları `scripts/critic-views-da2.json`. **Blender:** render kameraları.
- **75c9035** 08:49 — Sokak planı, Doğan Avcıoğlu 2. bölüm (`street-plan.json`, `da2-*` girdileri): kaldırım
  bantları (kırmızı + gri + sarı; 503. Sk. batıda mavi bisiklet şeridi `bike: 1.15`), UPTOWN beyaz tuğla desenli
  duvar + küre lambalı direkler + leylandi, kemerli bej istinat duvarı, beton panel duvar + yeşil tel, gri lamelli
  yaya kapısı, otopark bariyeri, kanopili güvenlik kulübesi, lambalar, DUR levhası, ızgaralar, bank, kaldırım
  bisiklet piktogramı. Yeni çizimler: `street.ts` (`barrier`, `gatehouse`, `marking`, DUR levhası, katmanlı
  kaldırımda `bike`), `site.ts` `buildDriveGate(..., greySlats)`, `textures.ts` `roadSignTexture('stop')`.
  **Blender:** `NW/Mertkent/Street` yeniden kur; `mk_street.py`'ye aynı yeni türleri ekle.
- **65920c9** 08:54 — Bina 1540901773 ölçüldü (9 kat × 3.10 m, zemin +0.40, kırma çatı + orta teras; gri sıva
  `#778288`, beyaz `#b5b9b7`, girinti `#4b5a68`, kahve panel `#655144`); **taban izi köşe sırası ters çevrildi**
  (diğerleriyle aynı dönüş yönü). Dosyalar: `survey/1540901773.json`, `data/facades.json`, `data/footprints.json`.
  **Blender:** `NW/Mertkent/Blocks/1540901773` kur (halkayı yeni sıradan oku).
- **f08d894** — Bina 1540901794 (UPTOWN yanındaki 7 katlı blok) ölçüldü: 7 kat × 2.94 m, zemin +0.55; kırma
  kiremit çatı + orta düz şerit, ince düz saçak ~1.3 m taşma; gri sıva `#8b9493`, merdiven kulesi `#818282`,
  balkon alınları turuncu-bej `#ad8d5f` (yalnız köşe yığınlarında K1–K4, ortada K1–K5; diğerleri gri), cam
  korkuluk `#4a515c`, antrasit doğrama `#4a5058`, koyu taban `#4b5663`. Köşeleri saran balkon yığınları (d≈1.0),
  cam merdiven şaftı, K6 geri çekilmiş teras, kepenkli garaj kapısı. Arka (kuzey) cephe de ölçüldü. Belirsiz:
  güneybatı köşe ~1.5 m kuzeyde olabilir, doğu duvar x≈219.5 düz olabilir (taban izi değiştirilmedi).
  Dosyalar: `survey/1540901794.json`, `data/facades.json`. **Blender:** `NW/Mertkent/Blocks/1540901794`.
- **f08d894** — Bina 1546358554 ("Şehr-i Bursa Evleri", 503. Sk. batı köşesi) ölçüldü: 6 kat × 2.95 m, zemin
  +0.20; kırma kiremit çatı (K-G ve D-B mahya), loca (içe gömük) balkon yığınları üstünde gri parapet kutuları;
  koyu sıva `#666f71`, açık gri `#a2a6a4`, pilastrlar `#6f777e`, beyaz döşeme alınları `#acafa8`, loca tavanı
  `#8a8d88`; çelik boru korkuluklar (cam yok); kuzey cephede kat başına perde türleri ölçüldü (`curt`). Taban izi:
  köşe 3–4 0.6 m doğuya (Street View iç oranlarından). Dosyalar: `survey/1546358554.json`, `data/facades.json`,
  `data/footprints.json`. **Blender:** `NW/Mertkent/Blocks/1546358554` (halka güncellendi).
- **dbb6868** — Bina 1540901772 (503. Sk. doğu / Doğan Avcıoğlu güney, kemerli istinat duvarlı site) ölçüldü:
  6 kat × 2.90 m, **zemin +3.80 m** (bina istinat duvarı arkasında yükseltilmiş sitede), kırma kiremit çatı + orta
  teras, saçak ~0.6 m; bej-gri sıva `#b0aba1`, pencere çevreleri `#c2c2b9`, balkon alınları `#aca79e`; batı
  çıkmada, kuzey ve güney ortada kavisli katlanır cam balkon yığınları (loca olarak, 1.3 m içeri), kuzey kanatlarda
  ~0.45 m sığ fransız balkonlar; kat başına perdeler (`curt`). Renkler bulutlu/gölgede ölçüldüğü için ×1.15
  (1540901773 için de aynı). Belirsiz: Street View üçgenlemesi batı duvarları 3.5–4 m batıda gösteriyor ama pano GPS
  hatası da bu mertebede → taban izi hava fotoğrafına göre bırakıldı. Dosyalar: `survey/1540901772.json`,
  `survey/1540901773.json`, `data/facades.json`. **Blender:** `NW/Mertkent/Blocks/1540901772`, `…/1540901773` renkleri.
- **dbb6868** — Kemerli istinat duvarı (`street-plan.json` → `da2-fence-arch`): duvar rengi `#a79880`, yeni
  `wall.arch = {pattern:[5.7, 2.5], rise:0.4, joint:"#2c3a33"}` — panel üstü yay (uçlarda 1.7 m, ortada 2.1 m),
  panel arası sivri kemer derzi (iki koyu 6 cm şerit, 0.25 m'den çeyrek elipsle 1.4 m yana kıvrılır), üstteki koyu
  yeşil korkuluk kemeri izler. Dosya: `src/worlds/mertkent/fenceGeneric.ts`. **Blender:** `mk_fences.py` kemerli
  duvar desteği; `NW/Mertkent/Street` yeniden kur.
- **(bu commit)** — Kullanıcı kalite kuralları `CLAUDE.md` §0'a yazıldı (tahmin yok, kat kat inceleme, en ince
  detay, dükkân tabelaları, Street View'a sadık sokak/ağaç/asfalt hasarı). **Blender:** aynı kurallar Blender
  tarafında da geçerli — görülmeyen detay uydurulmaz, veri dosyalarındaki her öğe aynen çizilir.
