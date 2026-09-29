# Pişirilmiş ışık (Blender Cycles → web oyunu) ve "Ultra" gerçekçilik hattı

Kullanıcı isteği (2026-09-29): "Blender tarafını pişirilmiş ışığı web oyununa geri vermeye çevir… gerçeğe en yakın his;
gerekirse mobilden açılmayacak kadar ağır olsun, sağlam bir PC GPU'su gereksin." → **Ultra** kalite düzeyi masaüstü
güçlü GPU içindir; Düşük/Orta/Yüksek mobil/zayıf cihazlar için eskisi gibi kalır.

## Neden bu yol (KARAR)

- Güneş gün içinde hareket ediyor (gerçek saat modu, gün batımı, gece) → **doğrudan güneş ışığı + gölgesi gerçek
  zamanlı kalır** (kademeli gölge haritası, yumuşak gölge).
- Gerçek zamanlı motorun yapamadığı şey **dolaylı ışık**: balkon altları, avlular, iki bina arası, duvar–zemin
  birleşimi, saçak altı, ağaç altı. Ekran uzayı AO (N8AO) bunları yalnız yakın ölçekte ve ekrandakine göre yapar.
- Bu yüzden Blender Cycles ile **gökyüzü görünürlüğü + sekme oranı** pişirilir: her yüzey noktasında, dolaylı ışığın
  engelsiz duruma oranı (0..1, lineer). Oyunda glTF `occlusionTexture` / three.js `aoMap` olarak yalnız **dolaylı**
  ışığı (ortam haritası + yarım küre) çarpar; güneş etkilenmez. Oran geometriye bağlı olduğu için günün her saatinde
  geçerli.
- Blender bu konteynerde ve GitHub Actions'ta `pip install bpy==4.2.0` ile Python modülü olarak çalışır (Cycles CPU,
  OIDN gürültü giderme). Yerel Blender oturumu gerekmez; yerel oturum (docs/BLENDER.md) aynı betikleri çalıştırıp
  sonucu görsel olarak inceleyebilir.

## Hat (uygulandı — 2026-09-29)

Dosyalar: `src/worlds/mertkent/lightmap.ts` (parça bölme, imza, uv1), `bakeexport.ts` (dışa aktarma kancası),
`baked.ts` (oyun tarafı), `scripts/bake-hash.mjs`, `scripts/bake-export.mjs`, `blender/bake/bake_ao.py`,
`.github/workflows/bake-lighting.yml`, `tests/unit/lightmap.test.ts`. Kancalar: `src/worlds/osm/world.ts`
(`OsmWorld.create` sonu), `vite.config.ts` (`define: __BAKE_SRC_HASH__`).

1. **Dışa aktarma** (`scripts/bake-export.mjs`, Playwright + başsız oyun `?debug=1&bakeexport=1`): el modeli
   meshleri (`mertkent <anahtar>`) dünya koordinatında, üçgenin ağırlık merkezine göre 100 m × 100 m parçalara
   (`--chunk 50` ile 50 m; manifest `chunkSize` taşır) bölünür ve `bake-work/src/chunk_<cx>_<cz>.glb` olarak
   yazılır (mesh adı = malzeme anahtarı), yanında `chunk_<cx>_<cz>.rects.bin` (ada dikdörtgenleri + ada normalinin
   yukarı bileşeni, float32 × 5). Öznitelikler:
   `position`, `normal`, `uv`, varsa `aux` → `_AUX`, ve **`uv1` → `TEXCOORD_1`** (ışık haritası uv'si, aşağıda).
   Alfa testli yaprak kartları vb. alıcı değildir, engelleyicilere girer. Engelleyiciler `occluders.glb`: arazi
   (bölge + 60 m, **0.3 m aşağıda** — 10 m ızgara üçgenleri çift doğrusal `H`'den birkaç cm sapıp üstüne serilen
   döşemeleri karartıyordu), OSM/Street View binaları, ağaç taçları (örnek başına elipsoid + gövde vekili).
   `export.json`: parça listesi (`sig`, atlas boyutu, gerçek yoğunluk), malzeme bilgileri (saydamlık/alfa), `srcHash`.
2. **uv1 — KARAR (sapma):** Lightmap Pack Blender'da değil `lightmap.ts`'te, **deterministik** olarak üretilir ve aynı
   kod oyunda da çalışır. Gerekçe: 1.9 M üçgenlik el modeli geometrisi GLB olarak ~190 MB (sıkıştırmasız) —
   150 MB bütçesini tek başına aşıyordu; oyun geometriyi zaten kendisi üretiyor. Böylece yayına **yalnız AO
   dokuları** girer, özel öznitelikler (`aux`) ve malzeme gölgelendiricileri aynen kalır, Blender'ın köşe
   yeniden sıralaması/bölmesi sorun olmaz. Algoritma: konumlar mm'ye yuvarlanır (tarayıcıdan bağımsız, yalnız
   IEEE-kesin işlemler), aynı düzlemdeki bitişik üçgenler (konumdan kaynaklanmış kenarlar, normal farkı < ~10°)
   tek ada; ada düzlemine izdüşüm (yatay adalarda en uzun kenar boyunca); 1 px pay; **4 px ızgarasına hizalı**
   dikdörtgenler (mip 0–2'de adalar birbirine karışmaz; gizli temas yüzlerinin siyahı uzakta görünen yüzlere
   sızmaz); ≤ 2 px adalar 4×4 hücreye esnetilir; raf paketleme. Atlas kenarı iki katına çıkmadan önce yoğunluk
   hedefin (8 cm/px) 1.25 katına kadar gevşetilir; en büyük atlasta (`maxAtlas`, 4096²) sığmazsa %12 adımlarla büyür
   (en yoğun 100 m parçalar 8–10 cm/px, doluluk %24–62). `BAKE_UV_VERSION` algoritma sürümüdür (manifest ile
   eşleşmeli).
3. **Pişirme** (`blender/bake/bake_ao.py`, bpy 4.2, Cycles CPU): tüm parçalar + engelleyiciler tek sahnede; parça
   başına bir nesne (malzeme yuvaları opaklık sınıfına göre ortak pişirme malzemesine bağlanır: opak yayınık albedo
   0.6; cam/su `opacity×0.8`, yaprak kartı 0.55, ağaç tacı 0.65 opak karışım). Beyaz gökyüzü 1.0, lamba yok,
   DIFFUSE (DIRECT+INDIRECT, renk yok), 3 sekme; 8 bit hedef görüntü, alfa = kapsama maskesi. **Oran = ışık /
   E0(n)**, `E0 = (1+n_yukarı)/2 + 0.6·(1−n_yukarı)/2` (düz açık alanda aynı normalin alacağı değer; oyundaki yarım
   küre/ortam ışığı zaten normale göre gök/zemin ayrımı yapıyor); n_yukarı ada dikdörtgenlerinden (`rects.bin`)
   gelir — ayrı NORMAL pişirmesi (bir sahne eşitlemesi daha) yalnız dosya yoksa. Pişirilen parçadan 60 m'den uzak
   nesneler Cycles'tan gizlenir (`BAKE_MARGIN_M`). OIDN (compositor Denoise, ayrı boş Workbench sahnesinde) yalnız
   büyük adalara; küçük adalar (kısa kenar < 12 px) OIDN'e verilmez (komşuya bulaşırdı), 4×4 hücreler kendi
   ortalamasına indirilir. Kapsanmayan pikseller 1.0. Parça atlasları 8192² **sayfalara** (dörtlü ağaç)
   yerleştirilir: `public/bake/ao_<n>.webp` (gri, WebP). Zemin: bölge dikdörtgeninde arazi vekilinin
   0.25 m üstüne kaldırılmış kopyası (döşemeler engellemesin) üstten pişirilir → `ground_ao.webp` (0.25 m/px).
   Süre bütçesi (`BAKE_TIME_BUDGET`): ilk (en büyük) parçadan toplam kestirilir; aşılırsa örnek sayısı düşürülür,
   16'nın altına inecekse Cycles AO'ya (25 m) geçilir ve ilk parça yeniden pişirilir.
4. **Manifest** `public/bake/manifest.json`: `{ version, uvVersion, srcHash, createdAt, blender, method, samples,
bounces, denoise, texel, unwrap:{texel,pad,maxAtlas}, pages:[{file,size}], chunks:[{id,bbox,sig,size,texel,page,
rect:[x,y,kenar],meshes}], groundAo:{file,rect:[x0,z0,x1,z1],mpp}, seconds }`. `srcHash` = `scripts/bake-hash.mjs`
   (SHA-1: `src/worlds/mertkent/**/*.ts` (baked/bakeexport hariç), `src/worlds/mertkent/data/*.json`,
   `public/data/osm.json`, `terrain.bin`, `src/worlds/osm/height.ts`, `src/env/terrain.ts`; CRLF→LF). Oyun aynı
   özeti derleme anında alır (`vite.config.ts` → `define`).
5. **Oyun** (`baked.ts`, `OsmWorld.create` sonunda): `ultraState.on` (oyunun Ultra kararı: ayar + GPU denetimi) veya
   `?bake=1` (`?bake=0` kapatır; `?bakeexport=1`'de hiç uygulanmaz). **Eskime denetimi iki katmanlı:** srcHash farklıysa
   konsolda uyarı; asıl karar **parça imzası** — üretilen geometrinin mm'ye yuvarlanmış üçgenlerinin özeti
   manifest'tekiyle tutmayan parça canlı (pişirmesiz) çizilir ve konsola yazılır. Tutan parçalarda üçgenler uv1'li
   yeni geometriye taşınır (anahtar × sayfa başına tek mesh; draw call artışı yalnız sayfa sayısı kadar), kalan
   üçgenler kaynak meshte kalır. Malzeme = oyunun kendi malzemesinin klonu + `aoMap` (R8 doku, `channel = 1`,
   yoğunluk 1); `onBeforeCompile` ve `customProgramCacheKey` (+`|bakedAO`) kopyalanır, Ultra yansıma kaydı korunur.
   Çarpışma dünyası değişmez. Arazi malzemesine (zincirlenmiş `onBeforeCompile`) dünya xz ile `ground_ao`
   örneklemesi: yalnız `indirectDiffuse`/`indirectSpecular` çarpılır. `bakedLighting.active` dışa açık (ör. SSAO
   şiddetini azaltmak için).
6. **CI** `.github/workflows/bake-lighting.yml`: `workflow_dispatch` (örnek, yoğunluk, yöntem, parça listesi, parça
   kenarı, atlas) + yalnız `main`'e itmede veri/üretici yolları değişince (KARAR: özellik dalı çok sık itiliyor,
   Actions dakikası). Adımlar: `npm ci` → ayrı klasöre derle → `vite preview` → dışa aktar → bpy kur
   (`pip install bpy==4.2.0 pillow numpy`) → pişir → boyut < 150 MB denetimi → yalnız başarılıysa `public/bake/`
   commit. KARAR: CI'da 50 m parça + 2048² atlas (özel depoların standart koşucusu 2 çekirdek / 7 GB; 100 m + 4096²
   pişirme ~5.5 GB tepe bellek ister, 50 m + 2048² ~¼'ü; yoğunluk aynı, yalnız parça başına sabit maliyet ×4).

### Yerelde tam pişirme

```bash
npx vite build --outDir /tmp/bake-dist
npx vite preview --outDir /tmp/bake-dist --port 4180 --strictPort &
node scripts/bake-export.mjs --out bake-work/src            # ~3–5 dk
pip install bpy==4.2.0 pillow numpy                          # Python 3.11
python blender/bake/bake_ao.py                               # BAKE_SAMPLES, BAKE_CHUNKS … (betiğin başı)
```

Blender kuruluysa aynı betik `blender --background --python blender/bake/bake_ao.py` ile de çalışır.

## Ultra gerçekçilik paketi (gerçek zamanlı)

- Kademeli gölge haritası (CSM, 4 kademe, 4096²), PCSS/yumuşak gölge, yüksek çözünürlük; `devicePixelRatio` tam.
- Gerçek HDRI gökyüzü (Poly Haven CC0, bulutlu yaz öğleden sonrası — Street View kareleri parçalı bulutlu) hem arka
  plan hem ortam haritası; güneş yönü HDRI'deki güneşle hizalı; bulut gölgesi (yavaş kayan düşük frekanslı maske).
- Son işlem: TAA veya SMAA 2×, **film greni** (luma'ya bağlı, çok hafif, zamanla değişen), hafif kromatik sapma
  (kenarlarda), vinyet, lens bloom yalnız parlak kaynaklar, renk LUT'u (Street View kalibrasyonundan), keskinleştirme,
  isteğe bağlı hafif hareket bulanıklığı. Pozlama otomatik göz uyumu (gölgeye girince açılma).
- Ekran uzayı yansıma (SSR) camlarda ve ıslak zemin yok; cam için gerçekçi ortam küpü (bölgesel yeniden yakalama).
- Malzeme: cephe kiri/yağmur izi (pencere altı akıntı, zemine yakın kararma), asfalt yama/çatlak yalnız ölçülen yerde.
