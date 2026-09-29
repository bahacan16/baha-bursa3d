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
- **f9bdb42** — Kullanıcı kalite kuralları `CLAUDE.md` §0'a yazıldı (tahmin yok, kat kat inceleme, en ince
  detay, dükkân tabelaları, Street View'a sadık sokak/ağaç/asfalt hasarı). **Blender:** aynı kurallar Blender
  tarafında da geçerli — görülmeyen detay uydurulmaz, veri dosyalarındaki her öğe aynen çizilir.
- **51e642f** — Üretici yeni özellikler (kullanıcı kuralı: kat kat detay, tahmin yok):
  - Balkon `bal` kat kat: `rail` (kat → glass | glassFull | tube | bars | solid | solidTube | none), `fasciaC`
    (kat → alın/parapet rengi), `railC` (metal rengi), `parapetH` (kat → dolu parapet yüksekliği). Varsayılan
    eskisi gibi `glass` (0.38 m dolu parapet + buzlu cam). Loca balkonlar da aynı.
  - `proj`: duvardan taşan kütle (merdiven kulesi, çıkma, kolon) — u0..u1, d, y0..y1, renk, ön yüz pencereleri `wins`.
  - `sign`: tabela (kutu / tek harf / pano / ışıklı kutu): yazı, zemin/yazı/kenar rengi, yazı tipi, ışıklı.
  - `awning`: tente (y yüksekliğinden d dışarı, drop sarkma, renk, valans yazısı).
  - Pencere `shut`: kat → dış panjur / dükkân kepengi kapanma oranı (galvaniz lamel + kutu).
    Dosyalar: `survey/schema.ts`, `scripts/survey-compile.mjs`, `facade.ts` (`parapet`, `proj`/`sign`/`awning`,
    `addWindow`), `index.ts` (`colorKey`, `signFace`, `mkShutter`), `textures.ts` (`shopSignTexture`).
    **Blender:** `mk_facade.py`'ye aynı öğe türleri ve kat kat korkuluk tipleri eklenmeli; tabela yüzleri yazıdan
    üretilmeli (Blender'da metin nesnesi veya resim dokusu).
- **7be7de4** — 1540901772 v3: tüm balkon/loca korkulukları `rail: {"*": "tube"}` (yatay paslanmaz boru,
  dolu parapet yok), `railC #c3cdd3`; güneybatı köşe balkonu derinliği 1.2 m; kuzey kanat K2'de "Kaymaz Emlak /
  SATILIK" pankartı (`sign`, panel, zemin `#e0e0e8`, yazı `#34436b`). Dosyalar: `survey/1540901772.json`,
  `data/facades.json`. **Blender:** `NW/Mertkent/Blocks/1540901772` (korkuluk tipi boru, tabela).
- **7be7de4** — Doğu paftası hava fotoğrafı `streetview-src/aerial-e/` (x 230…730, z −350…150) + 18 bina için
  yakın plan kare planı. **Blender:** — (referans)
- **224de3e** — Üretici ek özellikleri (ajan raporlarındaki eksikler):
  - Pencere `grille` (kat → bars | ornamental | lattice, `grilleC`), `lower` (kapı/fransız pencere alt bölmesi:
    frosted | louvre | solid, `lowerC`); balkon `net` (kuş filesi katları); `groove` (sıva derzi, yatay/düşey),
    `vent` (menfez: yuvarlak/dikdörtgen, adet + aralık); `sign.lines` (çok satırlı, satır başına renk/boy);
    `panel`/`band` hex rengi; sokak planında `board` (direk/kapı panosu).
  - **Tabela montajı:** tabela altındaki `band`/`panel`/`proj`'un ön yüzüne oturur (önceden 12 cm dışarıdaki lamel
    bandın arkasında kalıp görünmüyordu). Dosya: `facade.ts` (sign dalı). **Blender:** tabela y-ofseti = altındaki
    bant/panel çıkıntısı + tabela derinliği.
  - **Cam balkon gölgelendiricisi hatası düzeltildi:** derz `smoothstep` kenarları tersti (GLSL'de tanımsız) → tüm
    panel çerçeve renginde, yani BEYAZ çıkıyordu. Artık koyu cam + 0.72 m derz (Street View'daki gibi). Tüm camlı
    balkonları etkiler. Dosya: `facadeMats.ts` (`camGlassMaterial`). **Blender:** cam balkon malzemesi koyu füme
    cam (iç ≈ #0b0d12, yansıma), beyaz değil.
  - **Vitrin camı:** dükkân camlarına artık ev perdesi atanmaz; yeni `vitrin` iç mekânı (loş dükkân içi, tavan
    spotları, raf siluetleri) — `curt` değeri `vitrin` (7), `kind: shop` varsayılanı. Dosya: `facadeMats.ts`,
    `facade.ts`. **Blender:** vitrin camları koyu, iç mekân loş.
  - Kuleli blok podyumu (massing gap) saçaksız düz çatı (açık gri saçak alnı yoktu). Dosya: `massing.ts`.
- **224de3e** — Bloklar v3 (kat kat korkuluk/alın/perde/tabela):
  - **1550826982** (DA kuzey, iki kuleli): 17 tabela (MiA / YÖNETİM VE GAYRİMENKUL, phenomenon KİTAP, EVRENSEL
    KİTAP + EV/REN/SEL logo kutusu, sacperisi.özlüce, Saç Perisi, BAYAN KUAFÖRÜ, Hoşgeldiniz, L'ORÉAL posteri,
    dil okulu yuvarlak tabelası), lamel bant #33393b (3.7–4.65 m, 12 cm çıkıntı), tüm balkonlar `glassFull`
    (çerçevesiz füme cam #66747e, alın #8e9798), K1 kepenkli kapılar (`shut`), 5 siyah kaplı ayak (`proj`),
    site girişi siyah tente. Görülmeyen: güney K8, kuzey K1 (varsayım olarak işaretli).
  - **1546358562 / 1546358556 / 1546358555**: tüm balkonlar `solidTube` (0.55 m dolu parapet + paslanmaz küpeşte
    #d0d6d9); dolu alın katları 562/556'da K2 koyu #50575f, 555'te K0 ve K3 koyu; kat kat perdeler; 562'de
    siyah çörtenler (`vent`), açık gri iniş boruları, güneybatı cam balkon kolonu; 556 kenar 8 yeniden ölçüldü.
    Görülmeyen: güney cepheler (rail/alın komşu kolondan, notlu).
  - **1546358554 / 1540901773 / 1540901794**: v3 alanları (korkuluk tipi, alın rengi, perde, tabela).
    Dosyalar: `survey/*.json`, `data/facades.json`. **Blender:** `NW/Mertkent/Blocks/<id>` bu 7 blok yeniden kur.
- **224de3e** — Sokak panoları `da2-board-sehri` (ŞEHR-İ BURSA EVLERİ), `da2-board-uptown`. Dosya:
  `data/street-plan.json`, `street.ts` (`board`). **Blender:** `NW/Mertkent/Street`.
- **224de3e** — Segment 3 taban izleri (Özlüce kavşağına kadar, 12 bina, hava fotoğrafı + SV, eğim ölçülü):
  1540901770/71/74/76/77, 1546816193, 1541439435/36/37, 303738118 (Cevher/Delice), 303738122 (Balıkçı Mahmut),
  1550614218 (MOSSA). **1541439439/40 bina değil** (boş arsa, "Vergi Dairesi proje alanı" levhası) → çizilmez
  (`index.ts` `NOT_BUILDINGS`). Dosya: `data/footprints.json`. **Blender:** bu iki OSM kaydını atla; taban
  izleri cephe ölçümü gelince kurulacak.
- **8a28401** — Üretici: balkon `glassC` (kat → korkuluk camının görünen rengi; 1550826982'de füme #66747e,
  önceden tüm cam korkuluklar açık yeşil buzlu camdı), `proj.topRail/topRailC/topParH` (çıkma / tek katlı ek üstü
  teras korkuluğu), `massing` parçaları artık z aralığı + kendi kat sayısı + çatısı alabilir (ör. 7/4/1 katlı
  kompleks; `gap` yoksa kuleler arası açık geçit), blok `pending` listesi (çizilemeyen detayların ölçüleri).
  `survey-overlay.mjs` tabela/tente/çıkma/derz/menfez çizer; `survey-plan-map.mjs` pafta kenarında kırpar.
  Dosyalar: `facade.ts`, `massing.ts`, `index.ts` (`colorKey('glass')`), `survey/schema.ts`,
  `scripts/survey-compile.mjs`, `survey/1550826982.json`, `data/facades.json`. **Blender:** korkuluk camı rengi
  kat kat; massing parçalarını ayrı kütle olarak kur; `NW/Mertkent/Blocks/1550826982` yeniden kur.
- **18bebc7** — Cam balkon başlangıcı korkuluk tipine göre (`camGlassSpan`): dolu parapetli (`solidTube`) balkonlarda
  cam parapet üstünden ve küpeştenin 13 cm ARKASINDAN, boru/çubuk/tam cam korkulukta döşemeden, buzlu cam
  korkulukta küpeşte üstünden başlar (562/556/555 yakın planları); alt profil çizilir. Cam balkon perdesi (stor/zebra)
  nane yeşili pastel yerine kırık beyaz-krem ve camın arkasında loş; pencerelerde yan fon perdeler daraltıldı
  (%12–16) ve koyulaştırıldı, kırmızı fon seyrek. Dosyalar: `facade.ts`, `facadeMats.ts`. **Blender:** cam balkon
  camı küpeştenin arkasında; perde dokuları nötr/loş.
- **c128da9** — UPTOWN Bursa (1540901794) güney girişi yakın plana göre düzeltildi (SyTa_58_7_40, 2025-09):
  - Sokak panosu (`board`) yüz yönü hatası: yüz ters tarafa bakıyordu (yazısız mor kutu görünüyordu) → düzeltildi;
    tüm `board` öğeleri etkilenir (`da2-board-sehri`, `da2-board-uptown`). Dosya: `street.ts`.
  - Yaya kapısı: Mertkent yaprak kaplı kapı yerine gri yatay lamelli çelik kanat (#676f70) + iki yanda 0.25 m kare,
    2.2 m açık mavi-gri kolon (#61717d) ve 0.29 m opal küre lamba (`gates[].style/color/pillars`). Dosyalar:
    `site.ts` (`buildSideDoor` biçim seçeneği), `index.ts`, `data/street-plan.json` (`da2-ped-gate-uptown`).
  - Kapı no "52": doğu kolonun sokak yüzünde koyu çelik tek tek rakam (0.12 m, `board` style `letters`, kutusuz)
    → `da2-no-52`.
  - Çit korkuluğu: tanımdaki "4 sıra yatay gri çelik boru" artık yatay borular (önceden dikey çubuk dokusu).
    Dosya: `fenceGeneric.ts` (`infDesc`). **Blender:** `NW/Mertkent/Street` — UPTOWN kapısı, pano yönü, çit boruları.
- **cd873e5** — 1540901773 taban izi (−0.30, +0.70) m ötelendi (yalnız öteleme; kenar uzunlukları, cephe ölçümü
  aynı): hava fotoğrafında eğim yönü −107.3° ve kat başına ≈1.0 m ölçüldü (balkon döşeme çizgisi periyodu), 9 katlı
  kulede toplam 9.2 birim → (−2.74, −8.78); eski eğim (8.2 birim) kısa kalıyordu. GB duvarın zemin çizgisi doğrudan
  görülüp doğrulandı (±0.25 m). 1540901772 ve 1540901794 kontrol edildi, < 0.3 m → değişmedi. Dosyalar:
  `data/footprints.json`, `data/facades.json`. **Blender:** `NW/Mertkent/Blocks/1540901773` yeniden kur.
- **841f093** — **Segment 3 (Özlüce kavşağına kadar) ilk ölçüm, 12 bina** (Street View 2025-09 ağırlıklı; 2014/2019
  kareleri yalnız geometri için, notlu). Dosyalar: `survey/<id>.json`, `data/facades.json`. **Blender:**
  `NW/Mertkent/Blocks/<id>` her biri için kur.
  - 1540901770 (Tarabya Sitesi bloğu, 7 kat; doğuda tek katlı kırmızı ek + cam korkuluklu teras = `proj` + `topRail`),
    1540901771 (6 kat, kum-bej, camlı loca yığınları), 1540901774 / 1540901776 (9 kat, derin portal çerçeve,
    K8 yalnız bir kısımda — üretici eksik, notlu), 1540901777 (Riva Konutları: 5 kat + çatı katı, kahverengi
    kaplama, merdiven kulesi camı, 4 parçalı `massing`), 1546816193 (2 katlı ticari sıra, iki blok arası 3.7 m açık
    geçit + tek katlı ek, `massing`), 1541439435 / 36 / 37 (8 kat kuleler, kavisli loca yığınları, K7 antrasit
    kaplama, 1437'de "A" blok harfi), 303738118 (Delice / Cevher / Özel Yeşil Beyaz Ağız ve Diş Sağlığı Polikliniği /
    İskele Balık — tüm tabelalar), 303738122 (Balıkçı Mahmut — tabelalar, turkuaz tenteler), 1550614218 (MOSSA:
    6/5/4/1 katlı parçalar, SOFT TOWN, TERZİOĞLU, VEFALI KÖFTECİ, TARİHİ TENCERE KÖFTECİSİ, Karina, SIEMENS).
  - Görülmeyen cepheler öğesiz bırakıldı (tahmin yok); her dosyanın `pending` listesinde üreticinin henüz
    çizemediği detaylar ölçüleriyle.
- **841f093** — Segment 3 sokak planı (`da3-*`, 74 öğe): kaldırımlar (SV olmayan x 245–590 arası yalnız hava
  fotoğrafından, malzeme "bilinmiyor"), site duvarları, lambalar, Özlüce döner kavşak adası (merkez 629.6,−82.1,
  ≈23×25 m), ayırıcı adacıklar, trafik ışıkları, yaya geçitleri, "BURSA VERGİ DAİRESİ BAŞKANLIĞI HİZMET BİNASI
  PROJE ALANIDIR." panosu, reklam panoları, doğu kaldırımı genç ağaçları. Bazı türler (ada, geçit, sinyal, pano
  sırası) üreticiye eklenecek. Dosya: `data/street-plan.json`. **Blender:** `NW/Mertkent/Street` segment 3.
- **841f093** — Asfalt dokusundaki hazır çatlaklar temizlendi (`scripts/clean-asphalt.mjs` →
  `public/textures/asphalt-clean/`, oyun bu kopyayı kullanır; `pbr.ts`). Gerçek hasar yalnız Street View'da
  görülen yerde çizilecek (kullanıcı kuralı). **Blender:** asfalt malzemesi `asphalt-clean` dokusu.
- **841f093** — `scripts/sv-extra.json`'a 1540901774/76 için 2025 karelerinden 11 ortofoto kaydı.
- **d078e71** — Üretici (D3 ajanlarının `pending` listelerinden):
  - `massing` parçaları: dünya çokgeni (`poly`, döndürülmüş şerit) ve `rest` (taban izinin kalanı), parça başına kat /
    çatı (ör. yalnız güney şeritte K8). Dosya: `massing.ts`.
  - Blok `volumes`: dünya çokgenli ek hacimler (tek katlı ek, kış bahçesi, çatı odası) — duvar rengi, üst bant, düz
    çatı, parapet + korkuluk, seçili kenarlarda giydirme cam (dikme aralığı, cam/doğrama rengi), çarpışma.
  - `roof.parapet`: çatı kenarında dolu parapet + korkuluk (saçak alnı yerine, çatı arkada saçaksız).
  - `floorHs`: kat başına farklı kat yüksekliği.
  - Pencere `frameC` (doğrama rengi), `tint` (renkli/yansıtıcı giydirme cam), `surround` (söve).
  - Tabela `outline` (harf konturu), `shape: round` (yuvarlak rozet, disk), `icon` (fish / tooth / star).
  - Tente `style: dutch` (çeyrek yuvarlak kabuk, yelpaze uç kapakları, şeritli dilimler).
  - **Hata düzeltmesi:** bitişik balkonlar tek plakada birleşince korkuluk tipi, camlılık ve cam tonu çokgenin ilk
    balkonundan alınıyordu → artık parapet balkon sınırlarından bölünüp her parça kendi balkonundan (ör. 1550826982
    kenar 22 K3: açık–camlı–açık).
    Dosyalar: `facade.ts`, `massing.ts`, `index.ts`, `textures.ts`, `survey/schema.ts`, `scripts/survey-compile.mjs`,
    `scripts/sv-survey-plan.mjs` (OSM'de olmayan `synthetic` taban izleri). **Blender:** `mk_facade.py` aynı özellikler.
- **d078e71** — Sokak türleri (`street.ts`, `siteplan.ts`): Özlüce döner kavşak adası (bordür, kırmızı parke
  bandı, iç bordür, çim, çiçek halkası, kenar çizgisi, yürünebilir), yaya geçitleri (0.5/0.5 m zebra), ayırıcı
  adacıklar, trafik ışıkları (3 lamba, siperlik), reklam panosu sırası (içerik yok — uydurulmadı), "sağdan gidiniz"
  ve sarı-siyah ok levhaları, kazıklı genç ağaçlar; ada ve adacıklarda hava fotoğrafı ağaç adayları kaldırıldı.
  **Blender:** `NW/Mertkent/Street` kavşak.
- **7ab41bf** — Segment 3 ölçümleri yeni üretici özellikleriyle (ajanlar `pending` listelerini dönüştürdü):
  1540901770 (kırmızı ek + cam korkuluklu teras + teras camlı odası artık `volumes`, tüm pencerelerde söve),
  1540901771 (söve), 1540901774/76 (K8 yalnız şeritte: `massing` poly + rest; 1776 bacaları), 1540901777 (doğu çatı
  katı ve batı çatı katı `volumes`, teras parapeti), 1546816193 (`floorHs` [4.0, 2.95], pencere başına cam tonu /
  doğrama rengi, çatı parapeti), 1541439435 (1.4 m çatı parapeti + boru korkuluk, füme cam korkuluk bölümleri,
  bronz doğrama), 1541439436/37 (çatı parapetleri, 1437 çatı köşkü `volumes`, füme cam bölümler, giriş saçağı +
  "A"), 303738118 (Cevher/Delice ekleri, İskele Balık kış bahçesi, çatı odası `volumes`; bölüm başına doğrama
  rengi; diş/balık simgeleri), 303738122 (balık simgesi, beyaz harf konturu, yuvarlak BALIK MARKET rozeti,
  Hollanda tenteleri), 1550614218 (5° eğik parça şeritleri, iki yükseklikli çekirdek).
- **7ab41bf** — Taban izi uzlaştırması: 1540901770 güney duvarları ≈1.0–1.1 m kuzeye (Street View derinliği +
  ölçülen eğim; eski "zemin çizgisi" ön döşeme şeridiymiş), köşe 10 düzeltildi; 1540901777 güney girintisi gerçek
  10.5 m genişliğe. Diğer yedi çelişki kanıtla reddedildi (notlarda). **Yeni, OSM'de olmayan 7 bina** (hava fotoğrafı
  - SV): 900000101 VİZE KONGRE / BALENTUR ofis bloğu, 102 LEYLA fasıl, 103 eczane + pilates eki, 104 TURUNCU Market
    konut bloğu, 105 beyaz kule, 106 KUDRET HOME / LINENS podyumu, 107 konut bloğu — cephe ölçümü için 77 yakın plan
    karesi istendi (`sv-extra.json`). Dosya: `data/footprints.json`. **Blender:** ilgili bloklar yeniden kur.
- **e783d25** — D1+D2 yakın plan eleştirmen bulgularından ilk düzeltmeler:
  - Cam balkon gölgelendiricisi: panel başına rastgele parlaklık "mozaik gürültü" gibi görünüyordu → karanlık iç +
    yumuşak kıvrımlı beyaz tül (çoğu dairede) + gökyüzü yansıması; "blinds" artık yoğun açık tül, şerit değil;
    derz profilleri açık gri. Pencerelerde yan fon perde krem-bej, düşük kontrast (kahverengi kareler yok).
    Vitrin camı daha koyu/şeffaf (opak kahve panel görünümü yok). Dosya: `facadeMats.ts`.
  - Sıva lekelenmesi azaltıldı (metre ölçekli bulut lekeleri: mottle 0.05 → 0.018). Dosya: `facadeMats.ts`.
  - Şehr-i Bursa bloklarında koyu gri (plaster2) açıldı: 561 #666b72→#6a727a, 562/556/555 #50575f→#5a636b;
    1546358554 ana sıva #666f71→#707a7e. Dosyalar: `survey/*.json`, `data/facades.json`.
    **Blender:** cam balkon malzemesi (tül), sıva malzemesi, ilgili blok renkleri.
- **1b160a8** — **Genel gündüz ışığı Street View'a kalibre edildi** (71 yama, 11 görüş, fotoğraf başına serbest
  pozlama): ortam ışığı güneşe göre ~2× fazlaydı (soluk/pastel görünümün asıl nedeni). `envScale` 0.085→0.038,
  yarım küre ×0.75→×0.6, güneş rengi #fff4e2→#faf5ed, env zemin/ufuk bandı nötr-soğuk, pozlama 1.278→1.75, renk
  düzeltme gölge/parlak tonu nötre yakın, doygunluk 1.04→1.0, kontrast 0.28→0.14. Güneş/gölge oranı hatası 0.56→0.16
  durak; nötr yüzeylerde ΔE 6.7→4.3; sarı kayma b* +4.4→+1.0. Dosyalar: `src/game.ts`, `src/env/daylight.ts`,
  `src/env/post.ts`. **Blender:** Cycles'ta fiziksel ışık zaten doğru; referans: güneş #faf5ed, gökyüzü/ortam oranı.
- **1b160a8** — Kavşak kuzeydoğusundaki OSM'de olmayan binalar ölçüldü ve çiziliyor: 900000101 (VİZE KONGRE /
  BALENTUR / KURUMSAL HİZMETLER / H8 PILATES / pizzabulls / DİŞ HEKİMİ ERTUĞRUL ÖZTÜRK / S.M. MALİ MÜŞAVİR RECEP
  DÜLGER…; mavi giydirme cam, loca bölümü, çatı katı), 102 (LEYLA fasıl + pergola terası), 103 (ECZANEMİZ ÇOK
  YAKINDA + PILATES house), 104 (GÜLTEN KARADAĞ HAIR DESIGN, TURUNCU Market tenteleri, cabinas), 105 (beyaz kule,
  kahve kaplamalı çıkma, loca balkonlar), 106 (KUDRET HOME + LINENS podyumu). 107 hiçbir karede ölçülebilir değil →
  çizilmedi (tahmin yok). Dosyalar: `survey/9000001xx.json`, `data/facades.json`. **Blender:** bu 6 blok kur.
- **(retro-1)** — Eski ölçümler yeni standarda (1. parti): 1540901795 / 1540901796 / 1540901798 survey dosyaları kat
  kat güncellendi (cam korkuluk + parapet yüksekliği, alın/cam/korkuluk renkleri, kat kat perde, "CITY 124 KİRALIK"
  afişi ve pencere "KİRALIK" kâğıtları, 98'de sıva derzleri + mavi dolu korkuluk, palet düzeltmeleri). Görülmeyen
  cepheler yalnız geometri (perde/afiş kopyalanmaz). Henüz `data/facades.json`'a derlenmedi (diğer retro ajanlarıyla
  birlikte derlenecek) → oyunda değişiklik yok. **Blender:** şimdilik yeniden kurulacak katman yok; derleme sonrası bu
  üç blok.
- **(bu commit)** — **Cephe / sokak üreticisine yeni öğeler** (eleştirmen + ölçüm ajanlarının `pending` listeleri;
  şema `survey/schema.ts`, derleme `scripts/survey-compile.mjs`, çizim `facade.ts`, `fenceGeneric.ts`):
  - `pilaster` (kabartma pilastır: u0..u1 / u+w, y0..y1 ya da kat aralığı `s`, çıkıntı d, renk, başlık/kaide),
    `pediment` (üçgen alınlık; `apex` ile asimetrik, `h`/`yTop`, balkon yığını önünde `d`, eğik üst yüzler, silme),
    `recess` (duvar girintisi: ağız boş, içindeki pencere/tabela/menfez arka duvarda; arka/yan/tavan/taban rengi),
    `mast` (bayrak direği). Bodrum pencereleri: `win.s: [-1,-1]` (subasman kesilir). Merdiven kovası penceresi
    `win.stair` (kat çizgisine kırpılmaz), yatay kayıtlar `win.hbars`, `split` sınırı 4 → 12 (ölçülmüş 5–8 bölmeli
    giydirme camlar artık doğru bölmeli: 303738118, 900000101, 1550826982).
  - Balkon: `bulge` (kavisli ön yüz, d = 0 ile duvardan duvara yay), `round` (köşe yarıçapı), `frameC` (kat kat cam
    balkon profil rengi), `tint: "frosted"` + `frostC`, `beam` (sarkan kiriş), `railH` (küpeşte boyu), `pots`
    (korkuluk üstü / döşemede saksı + bitki).
  - Çatı / hacim parapeti: `edges` (yalnız bu kenarlarda parapet, diğerlerinde saçak alnı), `railEdges`, `railH`
    (küpeşte ≈0.6 m), `coping` (harpuşta), `band` (alt bant); `proj.topRailH`; `volumes[].glazing.transom`; blok
    `pergolas` (dikme + kiriş + lamel + örtü).
  - Boru `color` / `r` / `y0..y1` / `brackets` (ince açık gri PVC boru; en üst katın üstünde havada kalan kelepçe
    hatası giderildi). Bant `style: "louvre"` (lamelli alüminyum alın). **Kepenk hatası düzeltildi:** kepenk dokusu
    metrede bir çizgi → düz beyaz kutu görünüyordu; artık 5 cm lamelli, `win.shutC` rengi, kutusu kepenk renginde
    (üstüne beyaz `box` çizilmiyor), alt profil koyu.
  - Çitler: `wall.relief` (kabartmalı prekast panel: baklava / madalyon / çerçeve), `pillars.style: "ornate"` +
    `finial` (top / piramit), 2D kaynaklı tel panel (`infillSpec.welded` ya da tipinde "2D"/"kaynaklı": kalın teller,
    V kıvrımları, dikmeler — da1-south-site, da2-fence-503-west, da3-fence-east-site artık böyle), aralıklı çalı
    (`hedge.style: "scattered"` + `gap`), kapı `style: "wrought"` (siyah ferforje, mızrak uçlu; street-plan gates).
    Kolon listesi dünya noktası başına yinelenmiyor (aynı konumda üst üste kolon hatası). **Kapı hatası
    düzeltildi:** komşu site kapıları (da1-…) ikinci kez Mertkent yaprak kapısı olarak da çiziliyordu (555/556
    önündeki siyah yaya kapıları yeşil yaprak kutusu görünüyordu); notunda "ferforje" yazan yaya kapısı artık
    ferforje (mızrak uçlu) çizilir. Kavisli balkon korkuluğunda dikmeler çevre boyunca ~1.2 m arayla.
  - Derleme: `copyOf` (görülmemiş) kenarlara artık yalnız geometri kopyalanır — tabela, bayrak, klima/çanak/kamera,
    perde/kepenk/parmaklık durumu, cam balkon tonu, file, saksı, tente yazısı kopyalanmaz (CLAUDE.md §0.1). Bu,
    yeniden derlemede 13 bloğun kopya kenarlarını değiştirir. Ayrıca balkon `tint` kat anahtarları ("K3" → "3")
    artık normalize ediliyor: 11 blokta "K"li yazılmış ölçülmüş cam balkon tonları yok sayılıyordu. İkisi de henüz
    `data/facades.json`'a derlenmedi (ölçüm ajanları derleyecek).
  - Dosyalar: `src/worlds/mertkent/{facade,fenceGeneric,index,textures}.ts`, `survey/schema.ts`,
    `scripts/survey-compile.mjs`, `tests/unit/facadeGen.test.ts`. **Blender:** kepenkli açıklıklar (lamel dokusu),
    borular, 5+ bölmeli giydirme camlar ve üç 2D tel panelli çit yeniden kurulmalı; yeni öğeler ölçümlere girdikçe
    ilgili bloklar.
- **(retro-2)** — Eski ölçümler yeni standarda (2. parti, yalnız survey JSON; `data/facades.json`'a henüz
  derlenmedi → oyunda değişiklik yok): Mertkent-2 blokları 1480041342/43/44/45 (iki tonlu sıva: K0–K2 beyaz, K3+
  gri; koyu gri balkon alnı + buzlu cam korkuluk; kat kat perde/cam rengi/çerçeve; yağmur boruları; uydurma ikiz
  kopyalar kaldırıldı), Mertkent 3 blokları 1480041300/01 (palet yeniden örneklendi, pilastır rengi düzeltildi,
  alınlık/çatı üçgeni modellendi, görülmeyen güney yüzleri yalnız geometri), 1480163634/37/38 (söve, kaplama
  derzleri, merdiven kulesi çıkması, pembe #dfb9b9), Salusvizyon 1479658783 (kuzey cephesi yeni karelerle yeniden
  ölçüldü — güneyin kopyası değil; oluklu taş pilastırlar, HAS KİLİT / KALE KİLİT tabelaları, lacivert cam
  korkuluklar). `scripts/sv-extra.json`: Salus kuzey cephesi ortofoto girdisi. **Blender:** derleme sonrası bu 10
  blok yeniden kurulacak (şimdilik yok).
- **(kamera)** — 1. şahıs görüş açısı 62° → 55° dikey (yumuşak geçiş; geniş açı bozulması), adımla senkron baş
  salınımı (yürüyüş ~1.6 cm, koşu ~3.2 cm; topuk vuruşunda en alçak). `docs/REALISM.md`: gerçekçilik planı.
  Dosya: `src/player/camera.ts`. **Blender:** yok (Blender kamerası için referans: göz 1.65 m, 55° dikey).
- **(retro-3)** — Eski ölçümler derlendi ve oyunda: 15 blok (`data/facades.json`: 1480041342/43/44/45, 1480041300/01,
  1480163634/37/38, 1479658783 Salusvizyon, 1540901795/96/98, 1546358557/61 — 557/561 kat kat balkon camı, pilastırlar,
  "SATILIK" pankartı pending). Mertkent-2 sokakları yeniden ölçüldü (`data/street-plan.json`): 502. Sokak kesiti
  (batı kaldırım 1.52 m: gri 0.65 / sarı kılavuz 0.32 / gri 0.40 / bordür 0.15; 1.1 m mavi bisiklet şeridi; yol 6.8 m;
  doğu kaldırım 1.17 m — eskisi 0.6 m ve ~1 m kaymıştı), 502/504 köşeleri, Şehr-i Bursa Evleri çiti (beyaz prekast
  madalyon panel, süslü kolon + siyah fener, yeşil 2D tel, jilet tel) ve güney taş duvar + leylandi, 5 yeni direk,
  pano, ızgara, rögar, Nato Parkı yaya geçidi; "ŞEHR-İ BAHAR" → "ŞEHR-İ BURSA EVLERİ"; olmayan güneydoğu kapısı
  silindi. **Blender:** bu 15 blok + Mertkent-2 çevresi sokak katmanı (kaldırım, çit, sokak eşyası) yeniden kurulmalı.
