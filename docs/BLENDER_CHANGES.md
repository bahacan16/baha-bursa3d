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
- **d59f88d (+a59d738)** — **Cephe / sokak üreticisine yeni öğeler** (eleştirmen + ölçüm ajanlarının `pending` listeleri;
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
- **(yeniden derleme)** — Üretici v5 derleme kuralları tüm bloklara uygulandı (`data/facades.json`): görülmeyen
  `copyOf` kenarlarında artık yalnız geometri (tabela/bayrak/perde/klima kopyası yok), "K3" biçimli cam balkon tonu
  anahtarları normalize → ölçülmüş tonlar görünür. Değişen: 1540901770/71/72, 1541439435, 900000105. CLAUDE.md
  kararlar güncellendi (Ultra, pişirilmiş ışık, 1. şahıs açısı, copyOf). **Blender:** bu 5 blok yeniden kurulmalı.
- **(v5 dönüşüm 1)** — Bekleyen (`pending`) ölçümler v5 üretici özellikleriyle veriye çevrildi ve derlendi:
  1480041300/01/42/43 (bodrum pencereleri `k:-1`, kat derzleri, pilastır aralıkları düzeltildi, saksılar, direk
  boyu), 1480163637 (orta bölüm 1.5 m girinti + köşe taşları), 1480163638 (iki cephede 1.3 m girinti, K0 pencere/kapı
  düzeltmesi, çift korkuluk hatası), 1540901795/96/98 (loca derinlikleri, açık gri PVC borular, alınlığı aşan gri
  panel hatası), 900000104 (çatı katı cephesi, batı teras saçağı, alınlık, pergola, saksılar, kepenk rengi),
  900000105 (parapet harpuştası, bay penceresi panelleri), 900000106 (KUDRET altın çerçeve, monogram paneli, alarm).
  Ayrıca kavşak köşelerinde bordürden yola asfalt dolgusu uyarlamalı (3–10 m): 502/Doğan Avcıoğlu köşesindeki bej
  hava fotoğrafı boşluğu kapandı (`street.ts`, `index.ts`). **Blender:** bu 12 blok + kavşak asfaltı yeniden kurulmalı.
- **(v5 dönüşüm 2)** — 900000101 (asimetrik çatı katı alınlıkları, giydirme cam kayıtları `hbars`, buzlu loca, panjur
  bandı), 900000103 (6 lamelli güneşlik, borular, kayıtlar), 900000102 (kablo kanalları), 303738122 (Balıkçı Mahmut
  lamelli pano, köşe hortumu), 303738118 (Cevher/İskele kış bahçesi kayıtları, taş subasman/parapet, mavi ahşap
  subasman). **Blender:** bu 5 blok yeniden kurulmalı.
- **(v5 dönüşüm 3)** — Doğan Avcıoğlu 1. kesim blokları: 1540901770 Tarabya (K0 giriş girintisi + kapı arka duvarda,
  çift derzler kat kat, balkon derinliği 0.9→0.47, köşe loca 1.77 m), 1540901771 (klima konumları), 1540901774 (çerçeve
  yuvası 2 m girinti, köşe balkonu yuvarlatma, bacalar), 1540901776 (kuzey çerçeve yuvası 2.3 m girinti), 1540901777
  Riva (güney girinti yeni ayak izine göre yeniden eşlendi: arka duvar kolonları, kırmızı kaplama, mavi giydirme cam,
  kanopi, "C" rozeti; loca kirişleri; K5 teras köprüsü). `scripts/sv-extra.json`: 1777 kenar 7 ortofoto girdisi.
  **Blender:** bu 5 blok yeniden kurulmalı.
- **(pişirme hattı, WIP 71e108a…c3f+)** — Pişirilmiş dolaylı ışık hattı (Ultra; ayrıntı `docs/BAKE.md`). Dışa aktarma
  `scripts/bake-export.mjs`: başsız oyundan (`?debug=1&bakeexport=1`, kanca `src/worlds/mertkent/bakeexport.ts`)
  el modeli meshleri dünya koordinatında 100 m (CI'da 50 m) parçalar hâlinde `bake-work/src/chunk_<cx>_<cz>.glb`
  (mesh adı = malzeme anahtarı; `TEXCOORD_1` = ışık haritası uv'si, `src/worlds/mertkent/lightmap.ts` deterministik
  üretir), `chunk_*.rects.bin` (ada dikdörtgenleri + normal), `occluders.glb` (arazi 0.3 m aşağıda, OSM/Street View
  binaları, ağaç taçları) ve `export.json`. Pişirme `blender/bake/bake_ao.py` (bpy 4.2 / Blender 4.2, Cycles CPU +
  OIDN): beyaz gök, lamba yok, albedo 0.6 → dolaylı ışık oranı; çıktı `public/bake/ao_<n>.webp` (8192² sayfalar),
  `ground_ao.webp` (0.25 m/px), `manifest.json`. Oyun: `src/worlds/mertkent/baked.ts` (Ultra veya `?bake=1`;
  `?bake=0` kapatır) — imzası tutmayan parça canlı ışıkta kalır. CI: `.github/workflows/bake-lighting.yml` (elle +
  `main`). **Blender:** el modeli sahnesi (`NW/*`) değişmedi, yeniden kurulum yok. Yerel oturum isterse aynı
  pişirmeyi kendi Blender'ında çalıştırabilir (önce oyunu derleyip `node scripts/bake-export.mjs`, sonra
  `BAKE_WORK=bake-work BAKE_CHUNKS=-1_-1 blender --background --python blender/bake/bake_ao.py`). Sonucu Blender'da
  görmek için `bake-work/src/chunk_*.glb` içe aktarılır; `UVMap.001` (uv1) → sayfa uv'si
  `((rect.x + u·rect.kenar) / sayfa, (rect.y + v·rect.kenar) / sayfa)` (manifest `chunks[].rect`, v üstten) ile
  `ao_<n>.webp` bir Emission/AO düğümüne bağlanır. `blender/bake/` bulut oturumunun klasörüdür; `blender-bridge`
  dalında bu klasörü değiştirme (çakışma olur).
- **(v5 dönüşüm 4)** — Doğan Avcıoğlu 2. kesim + kavşak: 1550614218 MOSSA (7 bölmede dükkân/alt/üst loca 1.8 m
  girintileri, girinti ağzında cam korkuluk, çekirdek 3.0 m geride + giriş kanopisi; eski 1.8 m sokağa taşan kanatlar
  kaldırıldı), 1546816193 (parapet lamelleri, yalnız görülen kenarlarda çatı korkuluğu), 1541439435 (KD çekirdek
  2.3 m girinti + giydirme cam, bronz cam balkon profilleri), 1541439437 (çekirdek 3.25 m girinti, kat kat profil
  renkleri, köşe çubukları), 1541439436 (GB başlık çıkması, profil renkleri). **Blender:** bu 5 blok yeniden kurulmalı.
- **(SV kamera kalibrasyonu)** — Street View kamera yüksekliği ölçüldü (`docs/SV_CAMERA.md`): 2025-09 **2.35 m**,
  2019-05 2.55 m, 2014-07 2.80 m (hepsi 2.5 varsayılıyordu). Kaldırım noktaları kameradan H − 0.15 aşağıda olduğundan
  2025 karelerinden 2.5 ile ölçülen kaldırım genişlikleri ×0.88. Düzeltilen sokak girdileri (`street-plan.json`, not:
  "H-kalibrasyon: a→b"): da2-sw-north-lot 3.70→3.25 m, da2-sw-503-east 2.00→1.75, da2-sw-503-west 2.30→2.05,
  da2-fence-503-west hattı/duvar/kolon, da2-fence-arch 503 kolu, da3-fence-east-site duvar 1.90→1.65 / pano üstü
  3.10→2.75 / çit 2.6→2.3, da3-fence-side-n/-s. Karşılaştırma kamerası artık pano tarihine göre göz yüksekliğinde.
  Cephe ortofotoları varsayılan 2.5 ile kalır (ölçüler/`base` onlara göre; fark yalnız düşey kayma). **Blender:**
  Doğan Avcıoğlu 2–3. kesim kaldırım/çit katmanı (bu girdiler) yeniden kurulmalı.
- **(üretici v6)** — Cephe / sokak üreticisi v6 (yeni alanları henüz hiçbir ölçüm kullanmıyor; ölçüm ajanlarına brif
  verilecek). Dosyalar: `facade.ts`, `roof.ts`, `builder.ts` (`bevelBox`), `facadeMats.ts`, `textures.ts`,
  `massing.ts`, `street.ts`, `site.ts`, `fenceGeneric.ts`, `siteplan.ts`, `survey/schema.ts`,
  `scripts/survey-compile.mjs`, `index.ts` / `osm/world.ts` (kancalar). Yeni öğeler: `cloth` (balkon içi branda),
  `banner` (korkuluk bayrağı / portreli pankart), `lamp` (aplik), `dormer` (çatı penceresi), `arch` (kemerli parapet /
  tonoz), `roofobj` (baca, TV anteni, çatı çanağı), `ribbon` (kavisli şerit). Yeni alanlar: pencere `curtC`/`curtF`
  (perde rengi / kapanma, "fon" perde), `behind` (loca arka duvarı ölçü düzeltmesi), çatı arası pencereleri (k =
  kat sayısı: alınlıkta / üçgen alınlıkta / kemerde); balkon `curtC`/`curtF`, `grille` (kemerli parmaklık), `spots`,
  `postEvery`, `hand` (dolu parapet küpeştesi), `coping`, `capC`/`capH`/`capSlope`/`capTrim`/`capRail`, `blinds`
  (bambu stor), `keepDoor`, `flowerC`, `arc` (ortak yay), kavisli gömük loca (inset + bulge); çatı `gableC`,
  `fasciaC`, `spots`, kenar bazında saçak (parapetsiz kenarlarda taşma); `plinthH` (0 = subasman yok), `wallTop`
  (blok / kütle parçası saçak kotu, parça `floorH`/`floorHs`); şerit uçları `point`/`flat`; pilastır `corner`/`joints`;
  alınlık `trim.base`; girinti `backS`/`sideS` + klima/çanak/kamera/aplik/boru/tente/giriş arka duvarda; çıkma `clad`,
  `back`/`topC`/`cap`, pencere korkuluğu; pano / bant `clad` (derzli kaplama dokusu); tabela `oval`, `glyphs`, 3B
  katmanlı harfler; kamera `dome`/`bullet`, `off`, `pair`; direk tepesi `top`; ek hacim `roof` (beşik / kırma / tonoz)
  ve `wins`. Sokak planı: çit `kind:"wall"` (serbest duvar), her kapıda `style`/`color`/`pillars` + `portal` (kolon,
  kiriş, harfler, kanat, trafik aynası), yol yüzeyi `patch`/`crack`/`pothole`/`wear`/`delineator`, yaya geçidi
  `wear`. Yüksek/Ultra kalitede döşeme alnı, denizlik, harpuşta ve bordürlerde 1.5 cm pah (Düşük/Orta değişmez; +%3.5
  üçgen). **Mevcut veride değişen geometri** (anlık görüntü karşılaştırmasıyla doğrulandı, başka fark yok): cam
  korkuluk dikmeleri + küpeşteleri ölçülen `railC` renginde (önce paslanmaz; cam korkuluklu tüm bloklar); beşik çatılı
  bloklarda alınlık duvarı cephe düzleminde + 0.15 m rüzgârlık, çatı arası pencereleri alınlıkta (1479658783,
  1480041344, 1480041345, 1480163634, 1540901796, 1546358555, 1546358556, 1546358562); ters yönlü ek hacim
  çokgenlerinde cam / korkuluk doğru yüzde (303738118, 1540901770, 1540901777); kütle bölünmesinde kesimi aşan tabela /
  tente bir kez, gerçek köşede kırpma yok, ek hacim / pergola tek parçada (900000101, 900000104, 1550614218,
  1550826982, 1540901774, 1540901776, 1540901777, 1546816193); saçak bandındaki derz (1540901771); loca arka duvarında
  ölçülmüş pencereler otomatik kapı yerine (1479658783 e0, 1540901795 e8/e12/e19/e26); 3B harf tabelalar (1541439437,
  1550614218, 1550826982, 303738122, 900000102); da2-ped-gate-uptown ölçülen biçimiyle (lamelli kanat ölçülen #676f70
  renginde, iki kolon + opal küre lamba). **Blender:** bu blokların `NW/Mertkent/Blocks/<id>` katmanları ve `NW/Mertkent/Street` (kapılar, Yüksek
  kalitede pahlı bordürler) yeniden kurulmalı; `materials.py`: `clad:*` (derzli kaplama), `blind:*` (bambu stor),
  `asphalt:*` / `tar:*` / `wear1..3` (yol yüzeyi) yeni malzeme aileleri. Pişirilmiş ışık bu bloklar için yeniden
  pişirilmeli (imza değişti).
- **(bu commit)** — **Ultra gerçekçilik paketi** (gerçek zamanlı; yalnız Ultra — Düşük/Orta/Yüksek davranışı ve maliyeti
  değişmedi). Kalite menüsünde 4. düğme "Ultra" (başlangıç ekranı + duraklat menüsü), `?q=ultra` zorlar. Ayarda Ultra
  açık olsa da yazılım işleyici / tümleşik GPU (Intel, Mali, Adreno, Radeon Graphics APU) algılanırsa kendiliğinden
  Yüksek'e düşer; menüden açıkça seçilirse yine açılır.
  - Güneş: three `SunLight` (2 kademeli CSM, kademe başına 4096², ~0–115 m / 115–450 m, görüş frustumuna oturur) +
    PCSS (merkez + 12 örnekli engel araması — yarıçap ~45 m'lik engelin yarı gölgesine göre, ince direk/tel gölgeleri
    kaybolmasın —, 20 örnekli Vogel PCF, etkin güneş çapı 1.1°, alıcı düzlemi derinlik eğimi → acne yok; kademe
    texel'ine göre normal ofseti → peter-panning yok): temas noktasında keskin, uzaklaştıkça yumuşayan gölge.
    Dosyalar: `src/env/lighting.ts`, `src/env/ultra.ts`.
  - Gökyüzü (varsayılan): fotoğraf gökyüzü — Poly Haven CC0 "Kloofendal 48d Partly Cloudy (Pure Sky)"
    (`scripts/fetch-textures.mjs` Actions'ta indirir → `public/textures/sky/sky.hdr`, 2k). HDRI güneşi (az 34°, yük.
    47.9°) oyundaki güneş azimutuna döndürülür, parlaklığı prosedürel göğe eşitlenir, güneş diski dışı yumuşak üst
    sınırlı; yalnız arka plan + yansıma (ortam ışığı kalibre prosedürel gökten). Oyundaki güneş 47.9°'den 15°'den fazla
    saparsa (sabah/akşam/gün batımı) ve `?sky=proc` ile prosedürel gök: Sky bulutları 1600 m'deki dünya düzleminde
    (örtü 0.32, rüzgâr 6.5 m/s). `src/env/hdrisky.ts`.
  - **Bulut gölgesi**: aynı bulut alanının yoğun çekirdekleri (örtü − 0.15 → zeminin ~%10–15'i) güneş yönünde yere
    izdüşürülür, yavaş kayar. Ortam haritası bulutsuz yakalanır (Street View ışık kalibrasyonu korunur).
    `?clouds=0..1`.
  - Hava perspektifi: yükseklikle azalan üstel pus (σ 0.00021/m, ölçek yüksekliği 1100 m → 500 m'de ~%10, 1 km'de
    ~%19), gerçek uzaklıkla (derinlik değil). `?haze=`.
  - Son işlem (`src/env/post.ts`, `src/env/taa.ts`): SMAA yerine TAA (Halton 8, Catmull-Rom geçmiş, YCoCg varyans
    kırpma; kamera kesmesinde — >6 m, >35° dönüş, fov değişimi — sıfırlanır); CAS keskinleştirme; kenarlarda hafif
    kromatik sapma; luma'ya bağlı, kare başı değişen ince film greni; yalnız çok parlak kaynaklarda (eşik 30: güneş
    diski, cam/araç parıltısı; girdi 300'de sınırlı) bloom; kısmi otomatik pozlama (merkez ağırlıklı log ortalama,
    referans ln L = −1.48 = 6 eleştirmen görüşünün ortalaması → ortalamada düzeltme 1.0; yarı güç, 0.85–1.45, ~0.8 s
    uyum); N8AO yüksek kalite, tam çözünürlük. `?grain= ?ca= ?sharp= ?ae= ?aeref= ?notaa ?noae`.
  - Pişirilmiş ışık kancası: ışık kalibrasyonu tek yerde (`src/env/calibration.ts`); `bakedLighting.active` iken ayrı
    küme (env / yarım küre / pozlama şimdilik canlıyla aynı — Street View yama setiyle yeniden oturtulacak:
    `?benv= ?bhemi= ?bexp=`) ve N8AO pişirmenin üstüne ikinci kez karartmasın diye 0.9 / 1.0 m (`?bssao= ?bssaor=`).
    Yeniden oturtmada otomatik pozlamayı kapatın (`?noae`) ya da referansı yeniden ölçün (`?aeref=`).
  - Cam/araç yansıması: oyuncunun çevresini yakalayan yerel yansıma küresi (256², her kare bir yüz, PMREM) → pencere
    camları, cam balkonlar, araç boyası/camı/kromu karşı cepheyi, ağaçları, sokağı yansıtır (yalnız aynasal; yayınık ışık
    kalibre gökten). `src/env/probe.ts`; kayıt: `facadeMats.ts` (iki cam malzemesi), `sim/carmodel.ts`. `?noprobe`.
  - Cephe yıpranması (grenli sıva malzemeleri): yerden ~0.6 m sıçrama kiri (düzensiz üst kenar, en çok %11 koyu), çok
    hafif düşey yağmur izleri (%5). Yalnız bu iki genel desen (görülmeyen leke uydurulmadı). `?weather=0` kapatır.
  - Cihazın tam piksel yoğunluğu (≤3), tüm dokularda en yüksek anizotropi, görüş 6.5 km, dallı ağaç menzili 160 m
    (1400 adede kadar), ayrıntılı ağaç 180 m.
  - Sağlamlık: Ultra'da malzeme çıkışı ve gökyüzü 3e4'e sınırlı, NaN → 0; TAA geçmişi / pozlama NaN-Inf ayıklar (tek
    bozuk piksel ekranı kalıcı siyah yapmasın); WebGL bağlam kaybı konsola yazılır (başsız karşılaştırmalardaki siyah
    ekranın asıl nedeni: ortak bellek grubunda GPU sürecinin OOM ile öldürülmesi → bağlam kaybı).
  - **Blender:** — (gerçek zamanlı gölge/son işlem; Cycles zaten fiziksel). İsteğe bağlı referans: aynı HDRI
    (`public/textures/sky/sky.hdr`) Blender dünya dokusu olarak kullanılabilir (güneş azimutu 165°'ye döndürülmüş).
- **(ayak izi FP-v3)** — Taban izi düzeltmeleri derlendi (`data/footprints.json`, survey'ler yeniden eşlendi):
  900000104 kuzey duvar 1.5 m güneye (bina eğimi bu binada ölçüldü 0.297 m/m; eski "KB girinti" bu hataydı),
  1540901770 Tarabya GD köşe 0.85 m batıya (kenar 16 öğeleri 0.72 m doğuya, hava fotoğrafıyla uyumlu), 1546358557
  güney duvarlar 1.03 / 0.68 m kuzeye (Street View GPS kayması güneye yanıltıyordu), 1480163634 4 → 8 köşe (kahverengi
  doğu kütle krem kısmın güneyde 1.5 m, kuzeyde 0.8 m önünde), 1480163637 kuleler ve girinti ağzı 0.66 m güneye.
  1480163634'ün eski ortofotoları kilitlendi (`sv-extra.json` `lock`; `sv-ortho.mjs` kilitli girdiyi yeniden üretmez).
  **Blender:** bu 5 bloğun taban izi, kütlesi, cepheleri ve çatısı + 770 ek bina/cam oda hacimleri yeniden kurulmalı.
- **(R4 zemin)** — **Gerçek zemin malzemeleri** (`scripts/real-textures.mjs` → `public/textures/real/<ad>/`,
  `albedo` sRGB + `normal` + `rh` [R yükseklik, G pürüzlülük, B mikro örtünme], 2k ve `-1k`; `manifest.json`
  ölçüler/kanıtlar). Ölçüler kullanıcı fotoğrafı `502sk-bati-bisiklet.jpg` metrik üst görünüşe düzeltilerek: gri ve
  kırmızı kilit taşı modülü 200 × 100 mm (uzun kenar yol boyunca, yarım şaşırtmalı), derz ≈3 mm, pah ≈5 mm 45°;
  kılavuz karo 400 × 400 mm, 6 çubuk (adım 64, üst 25, taban 32, yükseklik ≈5 mm); bordür birimi ≈0.72 m; site içi
  I taşı 200 × 139 mm adım (uç genişliği 165, uzun kenarlarda bel — eski dokuda çıkıntı yanlış kenardaydı).
  Doku ortalamaları (doğrusal→sRGB): gri `#9f9d94`, kırmızı `#998f86`, kılavuz `#b3aea2`, bordür `#a19e96`, boyalı
  bordür `#e2e2de`; taşlar arası ton CV 0.07. Oyunda `src/worlds/mertkent/realtex.ts` malzemeleri anahtar adıyla
  yükseltir (tek çağrı `index.ts`'de; `?norealtex` kapatır): `spPaverGrey`, `spPaverRed`, `tactile`, `spSiteGrey`,
  `spSiteRed` (UV metre, dokuda renk → malzeme beyaz), `curb` / `siteKerb` / `edging` / yeni `kerbPaint` (dünya
  uzayı üç düzlemli: kutu UV'si her birimde sıfırdan başlıyordu). Ultra: paralaks örtünme (derz derinliği).
  **Geometri:** `street.ts` kaldırım bordürleri 1 m → 0.72 m birim (derz aralığı); 502. Sk. batı (bisiklet şeridi)
  bordürünün yol yüzü + üstünün dış 8 cm'i beyaz boya (`street-plan.json` `east-west-side.kerbPaint = "white"`),
  orada yol kotundaki ayrı 10 cm beyaz çizgi kaldırıldı. Kaldırım katman anahtarı baş ifadeden (`layerKey`): 502. Sk.
  batı/doğu kaldırımları ve doğu kuzey köşesi artık gri kilit taşı + 0.40 m kılavuz şeridi (önce bandın tamamı kılavuz
  karoydu); kılavuz merkezi taş sayımıyla batı `at` 0.71 → 0.75, doğu 0.61 → 0.65; DA kuzey krem kenar taşı şeritleri
  çim yerine `edging`, gri ayırıcı kenar taşları `curb` dokusu. Pişirilmiş ışık: bu kaldırım parçalarının imzası değişti →
  yeniden pişirme gerekir (o parçalar canlı çizilir). **Blender:** `materials.py` → yukarıdaki zemin malzemeleri
  (Image Texture: albedo sRGB, normal Non-Color, rh.G pürüzlülük; rh.R yükseklik → Displacement/Bump, ölçek
  0.009 m; UV metre, doku boyu manifest `size`), bordür malzemeleri üç düzlemli (Box projection, 0.5 m);
  `NW/Mertkent/Street` yeniden kur (0.72 m bordür birimleri + boyalı bordür), `NW/Mertkent/Site` malzemeleri.
  Karşılaştırma görselleri: `docs/compare/ground-502sk.jpg`, `ground-da.jpg`, `ground-textures.jpg` (Blender: yok).
- **(ağaç türleri)** — **Ağaç türü kütüphanesi** (3 genel tür yerine 20 tür anahtarı; kanıt, tanıma ipuçları,
  örneklenen renkler: `docs/TREES.md`). Himalaya sediri (sarkık katlar, eğik tepe), mavi ladin, limoni servi
  (alev konisi), Akdeniz servisi, mazı konisi, Trachycarpus palmiyesi (lifli gövde + 30 yelpaze yaprak), ıhlamur,
  karaağaç tipi kubbe, akasya, top akasya (2 m temiz gövde + küre), sabun ağacı (kırmızı-kahve kapsüller), kan erik (anahtar hazır, veride yok),
  yenidünya, meyve ağacı, parlak yapraklı her dem yeşil, fidan, şimşir + genel yaprak döken/iğne yapraklı.
  Yaprak kartları çalışma anında canvas atlasında (tür başına 512 px karo), orta LOD seyreltilmiş kart, uzak LOD tür
  silüeti; Ultra'da yakın/orta 160/260 m. Veri: site planındaki 51 `cone` (limoni servi) ve mazı çalı sırası artık
  ağaç kütüphanesinde (sitekit `cypressCone` / `bush` çizilmez); sokak planındaki 2 m altı `tree` (KD köşe adası
  mazıları) küre değil mazı konisi. Tür düzeltmeleri: site-plan 3 `pine` → `cedrus`, **yeni** palmiye (-68.1,
  -62.6) ve genç sedir (-57.4, -62.7); park-plan top akasya (-21.5, -163.6), sabun ağacı (-12.9, -165.8),
  (-16.5, -176.9) ve "mor/kızıl yapraklı" `PURPLE` (-19.5, -171.9; kırmızı-kahve renk kapsül salkımıymış, yapraklar
  yeşil); parktaki tek mavi ladin 3 kerterizle (17.2, -172.6) → park-plan `n183Y` mavi ladin (h 2.9),
  aynı ağacın yanlış konumlu kopyaları park-plan `n164Y` ve street-plan `da1-tree-park-1` **silindi** (Blender'da
  da kaldırılmalı). `fixedTrees` artık ağaç başına 5 sayı
  (`x, z, tür, boy, taç yarıçapı`, metre). Dosyalar: `src/worlds/osm/` altında `species`, `treelib`, `leafcards`,
  `treefield`, `treemesh`, `eztree`, `vegetation`, `world` (.ts); `src/worlds/mertkent/{siteplan,street}.ts`,
  `data/{site,park,street}-plan.json`, `tests/unit/species.test.ts`.
  **Blender:** `NW/Vegetation` yeniden kurulmalı (tür başına model; konum/boy/taç ölçüleri planlardan; tür →
  `docs/TREES.md` tablosu); `NW/Mertkent/Site` (konik servi ve mazı çalıları buradan kalktı → Vegetation'a),
  `NW/Mertkent/Street` (KD köşe adası küreleri kalktı → mazı konisi Vegetation'da).
- **6273d2d** — Gerçekçi konumlu ses manzarası (yalnız ses): `src/env/sound/*` (HRTF + bina örtmesi, bina taban
  izlerinden kanyon/avlu/açık alan yankısı, zemine göre ayak sesi — ölçülmüş site/park alanları, rögar/ızgara
  noktaları, kaldırım/araç yolu, hava fotoğrafı rengi; araç başına motor/lastik/Doppler/korna, uzak cadde uğultusu,
  BursaRay geçişleri, kuş/rüzgâr/cırcır/köpek/çocuk, Diyanet vakitlerinde gerçek cami konumlarından ezan), ayarlar
  (Ana ses, Ambiyans, Trafik, Ayak sesi, Ezan + "Ezan sesi"), kayıt hattı `scripts/sounds.json` +
  `scripts/fetch-sounds.mjs` + `.github/workflows/fetch-sounds.yml` → `public/sounds/` (CC0/CC BY, ATTRIBUTION.md).
  Küçük bağlantılar: `game.ts` (ses güncelleme çağrısı), `camera.ts` (`step` okuyucu), `sim/traffic.ts`
  (`soundCars()`), `osm/world.ts` (`soundScene()`, `GroundIndex.pavedKind`), `osm/parse.ts` (`mosques`:
  building:part'lı camiler dahil), `hud.ts`, `settings.ts`.
  **Blender:** yok (görsel değişiklik yok; Blender'da ses kullanılmıyor).
- **(v6 dönüşüm 1)** — 1540901774 (yuva arka duvarında kapı `behind`), 1540901777 (merdiven kulesi kemerli başlık
  `arch` 0.57 m önde + altlık, kule camı 21.38'de biter, batı çatı katı pencereleri), 1541439435 (kavisli iç loca üç
  parçada tek kavis `arc`+`bulge` 0.55 + kavisli parapet, 0.9 m saçak, K7'ye uzanan girinti, mavi perdeler),
  1541439436 (terrakota perdeler), 1541439437 (çatı köşkü tonoz çatı, iki balkon yığını tek dışbükey kavis, K3 bayrak
  `banner`, kat kat perdeler). **Blender:** bu 6 blok yeniden kurulmalı.
- **(v6 dönüşüm 2)** — 1550614218 MOSSA (B4 klima doğuda, VEFALI tentesi tüm bölme 1.1 m + oval tabela, iki beyaz
  dome kamera, batı locaların sürgülü kapıları kat kat `behind`, kanat saçak üstü 18.85 + 0.5 alın, `plinthH 0`
  sanal subasman bandının vitrinleri örtme hatası giderildi, havada kapı kaldırıldı, lobi cam kapısı mullion'lardan),
  1546816193 (`plinthH 0`), 900000105 (bay kahve kaplama dikey derz 0.14, K3 loca arka açıklıkları), 900000106
  (LINENS oval tabelalar, KUDRET K+R monogram 3D altın harf, kahve kaplama derzleri, LINENS kapı üstü cam).
  **Blender:** bu 4 blok yeniden kurulmalı.
- **(yan sokak z≈−53 + direk boyları)** — Kavşak yanındaki yan sokak duvardan duvara **8.0 ± 0.3 m** (planda 6.5):
  güney duvar 1.7–1.9 m güneye, nokta sırası ters çevrildi (duvar ve çit yola çiziliyordu); duvar 0.8 m taş + 0.12
  harpuşta, koyu yeşil 2D tel 0.8–1.4 m, leylandi 3.9 m, 5 fenerli kolon; kuzey duvar kemer aralığı ölçülü 5.6 m,
  kemer 0.5, duvar 1.6; yeni `da3-fence-side-ne` düz duvar; bordürsüz kenar şeritleri (sahte kaldırım yok);
  rögar/ızgara/kasis. Direk boyları Street View ufuk yöntemiyle ölçüldü: Doğan Avcıoğlu lambaları 9 → 11.6–12.4 m,
  kavşak lambaları 12 → 10.5, kavşak kamera 10 → 9.0, trafik ışıkları 4.0 → 3.5; levhalar direkleriyle; da1 lambaları
  bordürden 1.5 m içeri. `da3-fence-east-site` nokta sırası ters çevrildi (aynı yön hatası: duvar + 2.3 m çit Doğan
  Avcıoğlu'na çiziliyordu). **Blender:** kavşak doğusu + yan sokak çit/duvar katmanı ve sokak lambaları yeniden kurulmalı.
- **(v6 dönüşüm 3)** — 900000104 (çatı katı alın `trim` tabansız, çatı katı pencere korkulukları, orta ayak
  aplikleri K1–K5, parapet harpuştaları, köşe dolgu hacimleri kaldırıldı), 1540901770 Tarabya (ayak aplikleri K1–K6
  yeniden ölçüldü, renkler düzeltildi; K3 kırmızı bez, K1 halı; cam yığın korkuluk 1.14 m; ek bina yalnız güney
  korkuluk), 1546358557 ("SATILIK" pankartı, siyah kablo, pilastır başlıkları + K2 denizlik bandı, K2 1.35 m tüp
  korkuluk, K3 harpuşta), 1546358561 (duvar silindirleri, K2 dikey Türk bayrağı). **Blender:** bu 4 blok.
- **(v6 dönüşüm 4)** — Kavşak köşesi ortak yükseklik referansı düzeltildi: 900000101'de sanal kamera ufku yüzünden
  kaldırım 1.1–1.4 m yukarıdaydı → 10 ortak özellikle (103 lamelleri, Leyla tabelası…) ölçek 1.104, rms 0.05 m; bina
  ≈%11 kısaldı (mahya 28.5 → 24.6 m), K0 eşikleri gerçek konuma, eksik vitrin eklendi, saçak bantları kütle
  parçalarına. 900000102 (Leyla fenerleri, iki tabela paneli ayrı renk), 900000103 (lamel üstü), 303738122 (turkuaz
  bant kavisli yükselişleri `ribbon`), 303738118 (çatı bacası + iki çanak `roofobj`). **Blender:** bu 5 blok.
- **(v6 dönüşüm 5)** — 1480041344/45 (kolon başlıkları `gableC` + panel, çatı alın rengi, çatı çanağı `roofobj`,
  345'te iki çatı penceresi — gerçek konum −64.4 / −53.6, hava fotoğrafındaki eğiklik düzeltildi; şerit uçları sivri/düz,
  kırmızı kurdele), 1480163634 (çatı katı pencereleri, K5 köprü çıkmaları, giriş kanopisi + fener, direk üstü disk,
  Atatürk portreli bayrak; köprü altındaki uydurma kahve derzler kaldırıldı), 1480163637 (orta kütle 7 kat, kemerli
  tonoz, girinti renk bölgeleri, klimalar arka duvarda), Salusvizyon 1479658783 (iki kemer yüzlü tonoz çatı, 27 Fransız
  balkon, tavan spotları, bordo panel derzleri, korniş bandı 25.17–26.47). **Blender:** bu 5 blok yeniden kurulmalı.
- **(FP-v4 1540901798)** — Taban izi 12 → 20 köşe: doğu cephe gerçekte ≈30 m ve basamaklı (GD kule 3.72 m, güney geri
  bant 3.78, ana duvar 14.88, kuzey geri bant 3.74, KD kule 3.92; bantlar 1.30 m, ana duvar 2.50 m kulelerin önünde;
  üç panoramadan köşe üçgenlemesi ±0.04 m); bina +0.8 m doğu / −0.25 m kuzey. Survey kenarları yeniden eşlendi (eski 6
  → 6–14), kule pencereleri 4 bölmeli Fransız pencere (kayıt, korkuluk yok), e5/e1 yanlış pencere kaldırıldı, beyaz
  PVC boru, dolu parapet üstü çelik küpeşte K4–K9, beyaz dikey şerit. `sv-extra.json` kilitli. Tepedeki sivri kemer
  bekliyor (üretici v7). **Blender:** bu bloğun taban izi, kütlesi, cepheleri ve çatısı yeniden kurulmalı.
