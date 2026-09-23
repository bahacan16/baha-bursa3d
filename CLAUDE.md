# Nilüfer Walk — Bursa 29 Ekim Mah. 3D Yürüme Simülasyonu

> Bu dosya Claude Code için proje spesifikasyonu ve çalışma talimatıdır. Her oturumun başında bunu oku, **Faz durumu** bölümünü güncel tut.

## 1. Amaç

Bursa / Nilüfer / 29 Ekim Mahallesi / **502. Sokak** merkezli, **2 km çaplı (1 km yarıçaplı)** bir alanda, web ve mobil tarayıcıda oynanabilen, **GTA tarzı üçüncü şahıs yürüyüşlü** bir 3D simülasyon.

- Tüm binalar, yollar, ağaçlar, zemin **gerçek 3D geometri** olarak render edilir (2D panorama / Street View tarzı "fotoğrafa zoom" **YASAK**).
- Oyuncu bir karakteri yürütür/koşturur, kamera karakteri arkadan takip eder; binalara çarpar, sokaklarda gezinir.
- Kurulum gerektirmez: statik site olarak GitHub Pages'te yayınlanır, telefonda link ile açılır.

## 2. İki render modu (aynı oyun, aynı kontroller)

Başlangıç ekranında kullanıcı modu seçer:

| | **Mod A — Gerçekçi (Google Photorealistic 3D Tiles)** | **Mod B — Oyun (OpenStreetMap 3D)** |
|---|---|---|
| Veri | Google Map Tiles API — Photorealistic 3D Tiles (Google Earth 3D verisi) | OpenStreetMap: bina taban poligonları, kat sayıları, yollar, parklar, ağaçlar |
| Görünüm | Gerçek fotoğraf dokulu fotogrametri mesh'i. Uzaktan çok gerçekçi, yakından "erimiş" | Temiz, oyun gibi, prosedürel cephe dokuları; bina şekli/yüksekliği gerçek |
| Gereksinim | Kullanıcının kendi Google Maps API anahtarı (Map Tiles API etkin, faturalandırma açık) | Hiçbir şey |
| Çarpışma | Mesh'e raycast (three-mesh-bvh) | 2D poligon çarpışması + zemin yüksekliği |

**Ortak katman (her iki modda):** OSM verisinden üretilen mini harita, sokak adı HUD'u, bölge sınırı, önemli noktalar listesi. Yani OSM verisi Mod A'da da yüklenir (render edilmez, sadece HUD/harita için).

Anahtar girilmemişse Mod A butonu pasif + açıklama gösterilir. Varsayılan mod: B.

## 3. Konum

- Merkez (yaklaşık, **doğrulanmalı**): `lat 40.218262, lon 28.909611` (502. Sokak, 29 Ekim Mah., Nilüfer).
- Doğrulama: `scripts/fetch-osm.mjs` içinde Overpass ile `way["highway"]["name"="502. Sokak"]` sorgusunu **merkez etrafında 1.5 km bbox ile sınırlayarak** çek (Bursa'da başka 502. Sokak'lar olabilir). Bulunan yolun uzunluk-orta noktasını merkez olarak kullan; bulunamazsa yukarıdaki koordinatta kal ve konsola uyarı bas. Sonucu `public/data/meta.json` içine yaz (`center`, `centerSource`).
- Oynanabilir alan: merkezden **1000 m yarıçaplı daire**. Veri indirme alanı: **1200 m** (kenarda boşluk görünmesin diye).
- Yakındaki bilinen yerler (OSM'den adla doğrula, hardcode ETME): Bursaray Özlüce İstasyonu, Uğur Mumcu Bulvarı, Bursaspor Özlüce Tesisleri, Tarabya Sitesi, Mertkent 3 Sitesi, Doğan Avcıoğlu Cad., Ahmet Taner Kışlalı Bulvarı. OSM'de bulunanlar "Işınlan" menüsüne eklenir.

## 4. Teknoloji yığını

- **Vite + TypeScript** (framework yok, vanilla). `strict: true`.
- **three.js** (güncel sürüm, yazım anında ~0.18x).
- **3d-tiles-renderer** (NASA-AMMOS, yazım anında ~0.5.x) — sadece Mod A. Eklentileri: `GoogleCloudAuthPlugin`, `GLTFExtensionsPlugin` (+ `DRACOLoader`, `KTX2Loader` gerekirse), `ReorientationPlugin`, `TilesFadePlugin`, `TileCompressionPlugin`, `UpdateOnChangePlugin`.
- **three-mesh-bvh** — Mod A çarpışma raycast'leri.
- Poligon üçgenleme: `THREE.ShapeUtils` / `earcut`.
- Test: **Vitest** (birim), **Playwright** (duman testi, headless Chromium).
- Harici CDN yok; her şey npm'den paketlenir.

> ⚠️ **Kütüphane API'lerini ezberden yazma.** Özellikle `3d-tiles-renderer`'ın import yolları (`3d-tiles-renderer/plugins` vs. kök), eklenti yapıcı parametreleri (ör. `ReorientationPlugin` lat/lon'u **radyan** mı alıyor), olay adları (`load-model`, `dispose-model`) sürümler arasında değişti. Kurduktan sonra `node_modules/3d-tiles-renderer/README.md`, `src/plugins/README.md` ve örnek dosyalarını (`example/googleMapsExample.js` vb.) oku, ona göre yaz.

## 5. Klasör yapısı

```
/
├─ CLAUDE.md
├─ README.md                  # Kullanıcı için: nasıl oynanır, API anahtarı nasıl alınır
├─ index.html
├─ vite.config.ts             # base: './' (GitHub Pages alt yolu için)
├─ package.json
├─ scripts/
│  ├─ fetch-osm.mjs           # Overpass → public/data/osm.json + meta.json
│  └─ fetch-terrain.mjs       # (Faz 5) yükseklik verisi → public/data/terrain.bin
├─ public/
│  ├─ data/                   # Üretilmiş veri (CI üretir; repoya da commit edilebilir)
│  └─ models/                 # Karakter glTF (CC0)
├─ src/
│  ├─ main.ts                 # Başlangıç ekranı, mod seçimi, oyun döngüsü
│  ├─ core/
│  │  ├─ geo.ts               # lat/lon ↔ yerel ENU metre dönüşümü
│  │  ├─ loop.ts              # Sabit adımlı fizik + render döngüsü
│  │  ├─ input.ts             # Klavye/fare/dokunmatik → soyut girdi durumu
│  │  └─ settings.ts          # Grafik kalitesi, API anahtarı (localStorage)
│  ├─ player/
│  │  ├─ character.ts         # glTF karakter + AnimationMixer (idle/walk/run/jump)
│  │  ├─ controller.ts        # Kinematik karakter kontrolcüsü (moddan bağımsız)
│  │  ├─ camera.ts            # 3. şahıs takip kamerası + 1. şahıs geçişi
│  │  └─ colliders.ts         # ICollisionWorld arayüzü
│  ├─ worlds/
│  │  ├─ osm/                 # Mod B
│  │  │  ├─ parse.ts          # osm.json → tipli özellikler
│  │  │  ├─ buildings.ts      # Ekstrüzyon, çatı, UV
│  │  │  ├─ facades.ts        # Prosedürel cephe doku atlası (canvas)
│  │  │  ├─ roads.ts          # Yol şeritleri, kaldırım, çizgiler
│  │  │  ├─ landuse.ts        # Çim, park, saha, otopark
│  │  │  ├─ vegetation.ts     # Instanced ağaçlar
│  │  │  ├─ rail.ts           # Bursaray rayları
│  │  │  ├─ chunks.ts         # 200 m ızgara parçaları, birleştirilmiş geometri
│  │  │  └─ collision.ts      # Poligon çarpışma dünyası
│  │  └─ google/              # Mod A
│  │     ├─ tiles.ts          # TilesRenderer kurulumu
│  │     ├─ collision.ts      # BVH raycast çarpışma dünyası
│  │     └─ attribution.ts    # Zorunlu Google atıfları
│  ├─ hud/
│  │  ├─ minimap.ts           # Dairesel, dönen mini harita (canvas 2D)
│  │  ├─ bigmap.ts            # Tam ekran harita (M)
│  │  ├─ streetname.ts        # Bulunulan sokak adı (GTA tarzı sağ alt)
│  │  ├─ boundary.ts          # Sınır uyarısı
│  │  ├─ touch.ts             # Sanal joystick + butonlar
│  │  └─ hud.css
│  └─ env/
│     ├─ sky.ts               # three/examples Sky + güneş
│     └─ lighting.ts          # Yönlü ışık, oyuncu çevresi gölge
├─ tests/
│  ├─ fixtures/osm-small.json # Küçük sahte OSM verisi (ağ gerektirmeyen testler için)
│  ├─ unit/*.test.ts
│  └─ e2e/smoke.spec.ts
└─ .github/workflows/deploy.yml
```

## 6. Koordinat sistemi

- Yerel teğet düzlem (ENU), merkez = `meta.json.center`. three.js'te **Y yukarı**, **+X doğu**, **−Z kuzey**.
- `x = (lon − lon0) · cos(lat0) · R · π/180`, `z = −(lat − lat0) · R · π/180`, `R = 6378137`. 1 km ölçeğinde hata ihmal edilebilir; yine de birim testi yaz (bilinen iki nokta arası mesafe haversine ile ±0.5 m).
- Mod A'da `ReorientationPlugin` ile merkez noktası orijine ve yerel "yukarı" +Y'ye getirilir; böylece iki mod aynı x/z uzayını paylaşır ve OSM mini haritası Mod A'da da doğru çalışır. **Bunu doğrula:** merkezdeki bir yol kavşağının Google mesh'indeki konumu ile OSM konumu arasındaki fark birkaç metreyi geçmemeli; geçerse kalibrasyon ofseti ekle.

## 7. Veri hattı (OSM)

### 7.1 `scripts/fetch-osm.mjs`
- Overpass API (`https://overpass-api.de/api/interpreter`, yedek `https://overpass.kumi.systems/api/interpreter`), `[out:json][timeout:120]`, bbox = merkez ± 1200 m.
- Çekilecekler: `building`, `building:part`, `highway`, `railway`, `landuse`, `leisure`, `natural` (tree, water, wood, scrub), `amenity`, `shop`, `barrier` (wall, fence), `name`'li node'lar.
- `out body; >; out skel qt;` ile node koordinatlarını da al.
- Çıktıyı **sadeleştir**: node id'lerini koordinata çöz, koordinatları merkeze göre **yerel metre** cinsine çevir (2 ondalık), gereksiz etiketleri at. Hedef: `osm.json` < 3 MB (gzip ile çok daha az).
- `meta.json`: `center`, `centerSource`, `fetchedAt`, `bbox`, `counts`, `attribution: "© OpenStreetMap contributors (ODbL)"`.

### 7.2 Ağ kısıtı
Claude Code'un çalıştığı ortam Overpass'a erişemeyebilir. **Bu durumda sahte veri üretme.** Yapılacaklar:
1. Scripti yaz, `tests/fixtures/osm-small.json` ile geliştirme ve test yap.
2. Gerçek veriyi **GitHub Actions** üretir (Actions'ın açık interneti var): `deploy.yml` build'den önce `node scripts/fetch-osm.mjs` çalıştırır.
3. Kullanıcı isterse yerelde `npm run fetch-data` ile üretip commit edebilir.
4. Uygulama çalışırken `public/data/osm.json` yoksa: Overpass'tan **tarayıcıdan** çekmeyi dene (CORS açık), başarısızsa anlaşılır hata ekranı göster.

## 8. Mod B — OSM dünyası detayları

### 8.1 Binalar
- Yükseklik önceliği: `height` → `building:levels × 3.1 m + 1.0 m` (zemin kat 4 m ise +0.9) → türe göre varsayılan: `apartments`/`residential`/`yes` (bölgede site tipi apartmanlar yaygın) = **5 kat**, `house` = 2, `commercial`/`retail` = 2, `school` = 3, `garage`/`shed` = 1. `min_height` / `building:min_level` destekle; `building:part` varsa ana `building`'i çizme (outline kuralı).
- Çok parçalı `multipolygon` ilişkiler: iç halkaları delik olarak işle.
- Çatı: varsayılan düz + parapet (0.8 m). `roof:shape=hipped|gabled|pyramidal` varsa basit çatı üret. Düz çatılara rastgele (deterministik tohumlu) su deposu / güneş paneli / anten küçük detayları ekle — Bursa silüeti hissi.
- Duvarlar ayrı, çatı ayrı malzeme grubu. UV: yatay = duvar boyunca metre, dikey = metre → pencere ızgarası gerçek ölçekte.
- Bina oturduğu zemine göre (Faz 5 arazi varsa) en düşük köşe noktasının arazi yüksekliğinden başlar.

### 8.2 Cephe dokuları (`facades.ts`)
- Başlangıçta canvas ile **doku atlası** üret (ör. 2048², mobilde 1024²): 8–12 cephe varyantı.
- Palet: Türk apartman tonları — krem, bej, açık somon, kırık beyaz, açık gri, toprak; pencere çerçevesi beyaz/antrasit; balkonlu varyantlar (koyu şerit + korkuluk).
- Kat yüksekliği 3.1 m'ye, pencere aralığı ~2.5 m'ye tekrar eden doku; zemin kat varyantı (dükkan camı) — bina içinde veya kenarında `shop`/`amenity` node'u varsa kullan.
- Varyant seçimi bina id'sinden deterministik hash ile.
- Hafif normal/roughness hissi için ikinci bir basit doku veya sadece `MeshStandardMaterial` roughness 0.85.

### 8.3 Yollar
- `highway` sınıfına göre genişlik: motorway/trunk 14, primary 12, secondary 10, tertiary 8, residential/unclassified 6.5, service 4, living_street 5, pedestrian 5, footway/path/steps 2.5, cycleway 2. `width` etiketi varsa onu kullan, `lanes × 3.2` ikinci öncelik.
- Şerit mesh'i: ofsetli polyline, kavşaklarda basit birleştirme (yuvarlak kapak/üst üste bindirme yeterli; z-fighting'e karşı sınıflara göre milimetrik y ofseti + `polygonOffset`).
- Araç yollarının iki yanına 2 m kaldırım (+0.15 m yükseklik, bordür yüzü dahil) — `sidewalk=no` ise çizme.
- Orta çizgi / şerit çizgileri: primary ve üstünde kesikli beyaz; yaya geçitleri `crossing` node'larında zebra.
- Bursaray (`railway=light_rail|subway|rail`): balast şeridi + iki ray; köprü/viyadük (`bridge=yes`, `layer`) varsa ayaklarla yükselt.

### 8.4 Zemin, alan kullanımı, bitki örtüsü
- Taban düzlemi: 2.6 km kare, asfalt-gri/toprak karışık hafif doku.
- `landuse=grass`, `leisure=park|garden|pitch|playground`, `landuse=residential` (site bahçeleri açık yeşil/beton karışık), `amenity=parking`. Sahalar çizgili yeşil.
- Ağaçlar: `natural=tree` node'ları + park/`wood` poligonlarının içine Poisson disk ile dağıtım (yoğunluk ayarlanabilir). **InstancedMesh**, 2–3 ağaç türü (gövde + düşük poligon tepe). Uzakta billboard'a gerek yok, instancing yeterli.
- `barrier=wall|fence`: ince ekstrüzyon (site duvarları bölgede çok, önemli).

### 8.5 Performans
- Dünyayı 200 m × 200 m **chunk**'lara böl; her chunk'ta aynı malzemeli geometrileri `BufferGeometryUtils.mergeGeometries` ile birleştir → hedef < 300 draw call.
- Mesh üretimini **Web Worker**'da yap (ana iş parçacığını kilitleme), yükleme ekranında ilerleme göster.
- Görüş mesafesi + `Fog`; mobilde kısa.
- Gölge: tek yönlü ışık, gölge kamerası oyuncuyu takip eder (±60 m), mobilde "düşük" kalitede kapalı.

### 8.6 Çarpışma (`osm/collision.ts`)
- Binalar ve duvarlar: 2D poligon kenarları (x/z) — oyuncu kapsülü = yarıçap 0.35 m daire. Uniform grid (10 m hücre) ile kenar arama.
- Çember–doğru parçası itme çözümü, kaymalı hareket (duvar boyunca sürtünerek ilerleme), bir karede en fazla 3 iterasyon.
- Zemin yüksekliği: Faz 5'e kadar 0; kaldırım üzerindeyken +0.15 (basamak çıkma ≤ 0.35 m otomatik).

## 9. Mod A — Google Photorealistic 3D Tiles detayları

### 9.1 Kurulum
- Kök URL: `https://tile.googleapis.com/v1/3dtiles/root.json`, `GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true })`.
- `ReorientationPlugin` ile merkez (bölüm 3) orijine; `TilesFadePlugin` ile LOD geçişleri yumuşak.
- Her karede: `tiles.setCamera(camera)`, `tiles.setResolutionFromRenderer(camera, renderer)`, `tiles.update()`.
- `errorTarget`: masaüstü ~6, mobil ~12 (ayarlardan değiştirilebilir). Yaya gözü seviyesinde yakın tile'ların en yüksek LOD'a inmesi gerekiyor; LRU cache limitlerini mobil bellek için ayarla.
- **Kapsam kontrolü:** yükleme sonrası merkez etrafında 150 m içinde mesh üçgeni yoksa "Bu bölgede Google 3D verisi yok" uyarısı ver ve Mod B'ye geç önerisi sun.

### 9.2 Çarpışma (`google/collision.ts`)
- Tile yüklendiğinde (`load-model` olayı — sürümdeki doğru adı doğrula) içindeki mesh geometrileri için `computeBoundsTree()` (three-mesh-bvh); yalnızca oyuncuya 150 m içindeki tile'ları çarpışma listesinde tut; `dispose-model`'de listeden çıkar ve `disposeBoundsTree()`.
- Zemin: oyuncunun 2 m üstünden aşağı raycast → en yakın isabet = zemin. Eğim > 45° ise duvar say.
- Duvar: hareket yönünde diz (0.5 m) ve göğüs (1.3 m) yüksekliğinden 0.5 m ileri raycast; isabet varsa hareketi yüzey normaline göre kaydır.
- **Spawn:** oyuncuyu merkezin 300 m üstünde başlat, fizik dondurulmuş; yerel tile'lar yüklenip aşağı raycast isabet edene kadar "Dünya yükleniyor…" göster, sonra zemine koy.
- Oyuncunun altındaki tile düşük LOD'a düşer/boşalırsa (isabet yok) oyuncuyu **dondur**, düşürme.
- Fotogrametri mesh'inde araçlar ve ağaçlar da "katı" — bu kabul edilebilir; ama kavşakta park etmiş araçlar yolu tıkarsa diye `Ctrl`/uzun basma ile "hayalet adım" (çarpışmasız 1 m ilerleme) ekle.

### 9.3 Zorunlu kurallar (Google Map Tiles API politikaları)
- Tile'lardaki telif atıflarını (`tiles` üzerinden toplanan copyright bilgisi) ve Google logosunu **ekranda sürekli** göster (`attribution.ts`). Uygulamadan önce güncel "Map Tiles API Policies" sayfasını kontrol et ve README'ye link ver.
- Tile'ları kalıcı olarak önbellekleme / indirme / Service Worker'da saklama **yok**.
- API anahtarı **repoya asla commit edilmez**. Kullanıcı başlangıç ekranında girer, `localStorage`'da saklanır (silme butonu olsun). README'de: anahtara **HTTP referrer kısıtlaması** (`https://<kullanıcı>.github.io/*`, `http://localhost:*`) ve **API kısıtlaması** (sadece Map Tiles API) koyma talimatı.
- Opsiyonel: `VITE_GOOGLE_MAPS_KEY` ortam değişkeni ile yerel geliştirmede otomatik doldurma (`.env.local`, `.gitignore`'da).

## 10. Oyuncu, kamera, kontroller

### 10.1 Karakter
- Model: three.js örneklerindeki **RobotExpressive.glb** (CC0, Tomás Laulhé; Idle/Walking/Running/Jump animasyonları var) → `public/models/`. Lisans notunu README'ye yaz. Ölçek ~1.75 m.
- `AnimationMixer` ile hız tabanlı geçiş (idle ↔ walk ↔ run crossfade 0.2 s), zıplama.
- Karakter hareket yönüne yumuşak dönsün (slerp).

### 10.2 Hareket
- Yürüme 1.6 m/s, koşma 5.5 m/s (GTA hissi için biraz abartılı olabilir: ayarlanabilir), ivme/yavaşlama yumuşatmalı, yerçekimi 9.81, zıplama 1 m.
- Fizik sabit adım 60 Hz, render değişken (akümülatör döngüsü).
- Hareket kamera yönüne göredir (GTA gibi).

### 10.3 Kamera
- Üçüncü şahıs: omuz üstü, mesafe 4.5 m, yükseklik 1.8 m; fare/sürükleme ile orbit (pitch −60°..+40°).
- Kamera ile karakter arasına raycast → duvar arkasına girmesin, kamerayı öne çek.
- `V`: 1. şahıs ↔ 3. şahıs (1. şahısta karakteri gizle, göz 1.65 m).

### 10.4 Masaüstü girdi
`WASD`/ok tuşları hareket · fare (Pointer Lock) bakış · `Shift` koşu · `Space` zıplama · `V` kamera · `M` büyük harita · `T` ışınlanma menüsü · `Esc` duraklat/ayarlar · `H` HUD aç/kapa.

### 10.5 Mobil girdi (`hud/touch.ts`, kütüphanesiz)
- Sol yarı: dinamik sanal joystick (dokunulan yerde belirir). İtme miktarı > %85 → otomatik koşu.
- Sağ yarı: sürükle → kamera.
- Butonlar (sağ alt): Zıpla, Koş (toggle), Kamera, Harita.
- `touch-action: none`, çoklu dokunuş, `visualViewport` ile adres çubuğu değişimlerine uyum, yatay mod önerisi (dikeyde de çalışsın).
- iOS Safari ve Android Chrome'da test edilebilir olsun; `devicePixelRatio` mobilde max 1.5.

## 11. HUD (GTA tarzı)

- **Mini harita** (sol alt, dairesel): OSM binaları gri, yollar beyaz, parklar yeşil, raylar koyu; oyuncu oku merkezde, harita oyuncu yönüyle döner; kuzey işareti; 150 m yarıçap görünüm; oynanabilir alan sınırı kırmızı daire.
- **Büyük harita** (`M`): tüm alan, sokak adları, oyuncu konumu, işaretlenen noktaya ışınlanma (dokun/tıkla + onay).
- **Sokak adı** (sağ alt, GTA'daki gibi kısa süre belirip solan): oyuncuya en yakın isimli `highway` ya da bulunulan site/park adı; değişince animasyonla göster. Mahalle adı üst satırda ("29 Ekim · Nilüfer").
- **Pusula / saat** (opsiyonel): gerçek saate göre güneş konumu (Faz 5).
- **Sınır:** merkezden 950 m'de ekran kenarları kırmızılaşır + "Bölge sınırı" uyarısı; 1000 m'de yumuşak duvar (daha ileri gidilemez).
- **FPS sayacı** ayarlardan açılabilir.
- **Atıf satırı** (sağ alt köşe, küçük): Mod B'de "© OpenStreetMap contributors", Mod A'da Google atıfları + OSM.
- Font: sistem fontu, kalın, gölgeli beyaz; GTA benzeri görünüm ama **GTA logosu/fontu/marka öğesi kullanma**.

## 12. Ortam

- `Sky` (three/examples) + yönlü güneş + hemisfer ışık; `ACESFilmicToneMapping`, `SRGBColorSpace`.
- Bursa'nın arka planda Uludağ'ı: Faz 5'te güneydoğu yönüne düşük poligonlu uzak dağ silüeti (gerçek yükseklik verisinden, kaba). Mod A'da gerek yok (Google verisinde var).
- Ayarlar: gündüz / gün batımı / gece (gece: sokak lambaları `highway=street_lamp` node'larında nokta ışık yerine emissive + birkaç yakın gerçek ışık).

## 13. Başlangıç ekranı ve ayarlar

- Başlık "Nilüfer Walk", kısa açıklama, iki büyük mod kartı, API anahtarı alanı (maskeli, "Nasıl alınır?" linki README bölümüne), kalite seçimi (Düşük/Orta/Yüksek — mobilde varsayılan Düşük, cihaz algılama ile), kontrol kılavuzu.
- Yükleme ekranı: yüzde ilerleme (veri indirme + mesh üretimi / tile yükleme).
- Hata ekranları: veri yok, WebGL yok, anahtar geçersiz (Google 403 → açık mesaj).

## 14. Dağıtım (`.github/workflows/deploy.yml`)

- Tetikleyici: `main`'e push + manuel `workflow_dispatch`.
- Adımlar: checkout → Node LTS → `npm ci` → `npm run fetch-data` (başarısız olursa commit edilmiş `public/data` ile devam et, uyarı ver) → `npm run test` → `npm run build` → `actions/upload-pages-artifact` → `actions/deploy-pages`.
- `vite.config.ts` → `base: './'`.
- README: "Settings → Pages → Source: GitHub Actions" adımı.

## 15. Test ve kalite

- **Birim (Vitest):** `geo.ts` dönüşümleri; bina yükseklik kuralları; poligon çarpışma (duvara doğru yürüyünce içeri girmeme, köşede takılmama, kaymalı hareket); yol şeridi ofset geometrisi (kendini kesmeyen basit durumlar); OSM ayrıştırma (multipolygon delikleri).
- **E2E (Playwright, fixture verisiyle):** sayfa açılır → Mod B başlar → canvas render eder (piksel boş değil) → `W` 2 sn basılı → oyuncu konumu değişti (test için `window.__game` debug kancası, sadece `?debug=1`'de) → mini harita çizildi → mobil viewport'ta (390×844, `hasTouch`) joystick görünür.
- Mod A için ağ gerektiren test yok; `tiles` mock'lanmış bir birim testi yeterli (spawn dondurma mantığı).
- Her fazın sonunda: `npm run lint && npm run test && npm run build` temiz geçmeli.
- Performans hedefi: orta segment Android (ör. 2022 orta seviye) Mod B Düşük kalitede ≥ 30 FPS; masaüstü Yüksek ≥ 60 FPS. `?debug=1`'de draw call / üçgen / bellek göstergesi.

## 16. Fazlar ve kabul kriterleri

**Faz 0 — İskelet**
Vite+TS, lint/format, Vitest, Playwright, klasör yapısı, boş sahne + sky, deploy workflow (fetch adımı henüz no-op).
✅ GitHub Pages'te boş gökyüzü sahnesi açılıyor.

**Faz 1 — Oyuncu ve kontroller (düz zemin üzerinde)**
Karakter, animasyonlar, 3. şahıs kamera, masaüstü + mobil girdi, sabit adımlı döngü, test kutularıyla çarpışma.
✅ Telefonda joystick ile yürünüyor, kutulara çarpılıyor, kamera duvara girmiyor.

**Faz 2 — OSM veri hattı + Mod B dünyası**
`fetch-osm.mjs`, fixture, binalar + cepheler, yollar + kaldırımlar, alan kullanımı, ağaçlar, raylar, chunk birleştirme, Worker'da üretim, poligon çarpışması.
✅ Gerçek veriyle (CI'da üretilen) 502. Sokak'ta doğuluyor, binalar doğru yerde ve yükseklikte, binalara girilemiyor, < 300 draw call.

**Faz 3 — HUD**
Mini harita, büyük harita, sokak adı, sınır, ışınlanma menüsü, atıf, ayarlar, başlangıç/yükleme/hata ekranları.
✅ Yürürken sağ altta "502. Sokak" yazıyor, sokağa dönünce değişiyor; mini harita dönüyor.

**Faz 4 — Mod A (Google 3D Tiles)**
Tiles kurulumu, anahtar yönetimi, BVH çarpışma, spawn/dondurma, kapsam kontrolü, atıflar, OSM HUD hizalama doğrulaması.
✅ Geçerli anahtarla fotogerçekçi mahallede yürünüyor, zemine basılıyor, binalardan geçilemiyor, atıflar görünüyor; anahtarsız Mod A pasif.

**Faz 5 — Cila (opsiyonel, sırayla)**
1. Arazi yüksekliği (AWS Terrain Tiles / Terrarium PNG, `fetch-terrain.mjs` CI'da) — Nilüfer eğimleri + Uludağ silüeti.
2. Gün döngüsü / gece + sokak lambaları.
3. Yaya NPC'ler (footway grafiği üzerinde rastgele rota, aynı karakter farklı renk tonlarıyla, instanced).
4. Hareketli araçlar (yol grafiği, şerit takibi, kavşakta basit bekleme; oyuncuya çarpmadan dur).
5. Ses: ayak sesi (zemin türüne göre), ortam uğultusu.
6. Fotoğraf modu (HUD gizle + serbest kamera).

## 17. Claude Code çalışma kuralları

1. Fazları **sırayla** yap; her fazın sonunda kabul kriterlerini kendin doğrula (test + build), sonra commit at. Bir faz bitmeden sonrakine geçme.
2. Her faz bitişinde aşağıdaki **Faz durumu** tablosunu güncelle; yapılamayan/eksik kalanları dürüstçe not et.
3. Ağ erişimin kısıtlıysa (Overpass, Google tiles, npm dışı kaynaklar) **sahte "gerçek" veri üretme**; fixture ile ilerle ve bunu belirt.
4. Kütüphane API'lerini `node_modules` içindeki README/tipler/örneklerden doğrula (bkz. bölüm 4 uyarısı).
5. Gizli bilgi (API anahtarı) hiçbir dosyaya, log'a, test'e yazılmaz.
6. Büyük üretilmiş dosyaları (`public/data/*.json`) commit etmek serbest ama 10 MB'ı geçmesin.
7. Kullanıcı Türkçe konuşuyor; commit mesajları İngilizce olabilir, README ve arayüz metinleri **Türkçe**.
8. Belirsiz tasarım kararlarında makul varsayılanı seç, kodda `// KARAR:` yorumu ve bu dosyada not bırak; kullanıcıyı gereksiz soruyla durdurma.

## 18. Faz durumu

| Faz | Durum | Notlar |
|---|---|---|
| 0 İskelet | ✅ | Vite+TS, ESLint+Prettier, Vitest, Playwright, sky sahnesi, deploy.yml. Overpass bu geliştirme ortamından erişilemiyor (proxy 403) → fixture ile ilerleniyor. |
| 1 Oyuncu/kontroller | ✅ | RobotExpressive (CC0) + AnimationMixer, kinematik kontrolcü (60 Hz sabit adım), omuz üstü kamera + duvar raycast, V ile 1. şahıs, Pointer Lock (+sürükleme yedeği), dokunmatik joystick/butonlar (Zıpla uzun basış = hayalet adım). Test dünyası: `?world=boxes`. Gerçek telefonda elle test edilmedi (headless mobil viewport ile doğrulandı). |
| 2 OSM dünyası | 🟡 | Kod tamam: fetch-osm.mjs (Overpass, merkez doğrulama), sentetik fixture (`tests/fixtures/make-fixture.mjs`), binalar (yükseklik kuralları, multipolygon delikleri, building:part outline kuralı, eğik çatılar, parapet, çatı detayları), cephe atlası (shader'da fract+textureGrad), yollar/kaldırım (kavşakta kırpma, bordür), zebra, orta çizgi, alanlar, Poisson ağaçlar (InstancedMesh/chunk), Bursaray (köprü+rampa+ayak), duvar/çit, 200 m chunk, Worker'da üretim, poligon çarpışma + kaldırım zemini. **Gerçek veriyle doğrulanamadı** (bu ortamda Overpass 403) — CI'da üretilecek; kabul kriteri (502. Sokak'ta doğma, bina konum/yükseklik) ilk Pages dağıtımında kontrol edilmeli. Sentetik 4249 binalık stres testinde göz hizasında ~170–230 draw call. |
| 3 HUD | ✅ | Dönen dairesel mini harita (kuzey işareti, sınır çemberi), büyük harita (kaydır/yakınlaştır, sokak adları, tıkla+onayla ışınlan), GTA tarzı sokak adı (yol / site-park adı, kavşakta geniş yol öncelikli), 950 m sınır uyarısı + 1000 m yumuşak duvar, T ışınlanma menüsü (bilinen yerler OSM'de adla aranır), Esc duraklat/ayarlar (zaman, kalite, FPS, HUD, koşu hızı), H HUD, atıf satırı, başlangıç/yükleme/hata ekranları. Işınlanma listesi gerçek veride hangi yerlerin bulunduğuna bağlı. |
| 4 Google 3D | 🟡 | Kod tamam: TilesRenderer + GoogleCloudAuthPlugin (core/plugins), GLTFExtensions+Draco (yerel `public/draco`), Reorientation (lat/lon **radyan**; kütüphane çerçevesi X batı/Z kuzey → Y'de 180° çevrildi, birim testle doğrulandı), Fade/Compression/UpdateOnChange, errorTarget ayarı, mobil LRU sınırları, BVH çarpışma (150 m aktif liste, tembel BVH, diz/göğüs ray, 2 m üstten zemin ray, >45° duvar), spawn dondurma + kapsam kontrolü, 403 hata ekranı, atıflar, `?gcal=` kalibrasyon. **Gerçek anahtarla test edilemedi** (bu ortamda tile.googleapis.com ve politika sayfası erişilemez); resmî Google logo görseli yerine yazı logosu — politika sayfasından doğrulanmalı. OSM–Google hizası sahada kontrol edilmeli (gerekirse `?gcal=dx,dz`). |
| 5 Cila | 🟡 | **Gerçek veri artık repoda:** `fetch-data.yml` iş akışı Actions'ta Overpass + Terrarium'dan çekip `public/data`'ya commit eder (bu ortam Overpass'a erişemez). 502. Sokak OSM'de bulundu, merkez 40.2180548, 28.9073262; 1569 bina, 140 isimli yol. ✅5.1 arazi (10 m ızgara, binalar en düşük köşeden, yollar/kaldırım/ray araziyi takip eder, alan kullanımı araziye doku olarak boyanır, 64 km uzak arazi + Uludağ arka planda). ✅5.2 sürekli güneş + "Gerçek saat" modu, gece pencere ışıkları, sokak lambaları (+yakın gerçek ışıklar), yıldızlar; OSM'deki gerçek banklar/duraklar. ✅5.3 yayalar (yaya/yol grafiği, araç yolunda kaldırımda, kutu parçalı instanced figürler, oyuncunun önünde durur). ✅5.4 araçlar (sağ şerit, tek yön, kavşakta bekleme, öndeki araç/oyuncu için durma, gece farları; oyuncu yayalar/araçlarla çarpışır). ⬜5.5 ses, ⬜5.6 fotoğraf modu. |

## 18b. Kararlar (KARAR notları)

- Geometri doğrudan malzeme kovalarında biriktirilir (mergeGeometries'e eşdeğer).
- Etiketsiz araç yollarına iki yanlı kaldırım; zemin katında dükkan varsa +0.9 m.
- Yol köprüleri yükseltilmez (rampa/çarpışma karmaşası); ray köprüleri 7 m + 140 m rampa.
- Mobilde mini harita sol üste taşınır (joystick alanı).
- Düşük kalitede gölge ve çatı detayları kapalı.
- Projeksiyon WGS84 yerel yarıçaplarıyla (M, N) yapılır; spec'teki tek R formülü kuzey-güneyde ~%0.25 hata veriyordu (Google hizası için). Mesafe testi Vincenty ile ±0.5 m; haversine yalnızca kaba kontrol.
- Mod A'da Google logosu görsel değil yazı (marka dosyası paketlenmedi).
- 400 m chunk + çatı detayı/ray/bariyer tek malzeme ("detail"): gerçek veride 200 m ile ~440 draw call vardı → Yüksek ~200, Düşük ~75.
- Alan kullanımı ayrı mesh değil, arazi mesh'inin dokusuna boyanır (eğimde boşluk/z-fighting yok).
- Sokak lambaları: OSM'de bölgede yalnızca 3 lamba var; araç yolu kenarına ~32 m arayla eklenir (konumlar yaklaşık). Banklar ve duraklar yalnızca OSM'deki gerçek konumlar.
- Işınlanma menüsü OSM'deki gerçek adları gösterir; OSM'de bulunamayanlar (Tarabya Sitesi, Mertkent 3, Kışlalı Bulvarı) listelenmez.
- Yayalar RobotExpressive kopyası değil kutu parçalı figür (iskeletli kopyalar yaya başına ~14 draw call ederdi).
- Sis ana sahne ve uzak arka plan için ortak; Düşük kalitede uzak arazi kapalı.
- Yayın `gh-pages` dalına (Settings → Pages → Deploy from a branch: gh-pages). Bu ortamdan Pages API'sine erişilemedi.

## 19. Kullanıcının yapması gerekenler (README'de de olsun)

1. GitHub'da repo → Settings → Pages → Source: **Deploy from a branch → gh-pages / (root)**.
2. (Mod A için) Google Cloud Console → proje → faturalandırma → **Map Tiles API**'yi etkinleştir → API anahtarı oluştur → referrer ve API kısıtlaması koy → oyunda başlangıç ekranına yapıştır. Ücretsiz kota ve fiyatlar için Google Maps Platform fiyat sayfasına bak.
3. Önce Google Earth'te bölgede 3D binalar görünüyor mu kontrol et; görünmüyorsa Mod A orada çalışmaz.
