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

## Hat

1. **Dışa aktarma** (`scripts/bake-export.mjs`, Playwright + başsız oyun `?debug=1&bakeexport=1`): el modeli dünyasının
   (Mertkent + ölçülmüş bloklar + sokak planı, `mertkent*` meshleri) statik meshlerini dünya koordinatında, malzeme
   anahtarı adıyla, 100 m × 100 m parçalara (chunk) bölerek `bake-work/src/chunk_<cx>_<cz>.glb` olarak yazar.
   Öznitelikler: `position`, `normal`, `uv` (oyunun dokuları için), varsa `aux` → glTF `_AUX` (cam/perde
   gölgelendiricileri için). Engelleyici (occluder) olarak ayrıca: araziyi (bölge + 60 m pay) ve ağaç taçlarını
   (basit küre/koni vekiller) `bake-work/src/occluders.glb`. Yanında `bake-work/src/export.json` (chunk listesi,
   srcHash).
2. **Pişirme** (`blender/bake/bake_ao.py`, bpy): her chunk için meshleri içe al, `uv1` = Lightmap Pack (ada payı 2 px),
   doku yoğunluğu hedefi 8 cm/px (duvar), atlas ≤ 4096²; Cycles **AO değil, gerçek dolaylı oran** tercih edilir:
   beyaz gökyüzü (1.0) + beyaz yayınık yüzeyler (albedo 0.6) ile DIFFUSE pişirme (yalnız INDIRECT+DIRECT world,
   lamba yok) ÷ aynı normal için engelsiz gökyüzü değeri (= π·kosinüs ağırlıklı yarı küre, 1.0'a normalize) → oran;
   örnek 256, OIDN. Süre sınırı aşılırsa Cycles AO pişirmesine (mesafe 25 m, 128 örnek) düş. Çıktı:
   `public/bake/chunk_<cx>_<cz>.glb` (geometri + `TEXCOORD_1` + `occlusionTexture{texCoord:1}` gri JPG/WebP) ve
   **zemin için** üstten dünya-uzayı AO dokusu `public/bake/ground_ao.webp` (0.25 m/px, bölge dikdörtgeni
   `manifest.groundAo.rect`).
3. **Manifest** `public/bake/manifest.json`: `{ version, srcHash, createdAt, chunks:[{file,bbox:[x0,z0,x1,z1],
meshes}], groundAo:{file,rect:[x0,z0,x1,z1],mpp}, texel, samples, blender:"4.2" }`. `srcHash` = SHA-1(facades.json,
   footprints.json, street-plan.json, site-plan.json, park-plan.json, osm.json, terrain.bin, generator kaynakları
   `src/worlds/mertkent/*.ts`) — `scripts/bake-hash.mjs` hem dışa aktarmada hem oyunda (derleme anında
   `import.meta.glob` veya vite define ile) aynı şekilde hesaplanır.
4. **Oyun** (`src/worlds/mertkent/baked.ts`): kalite `ultra` (veya `?bake=1`) ve manifest srcHash güncel ise
   chunk GLB'leri yüklenir; üretilen `mertkent*` meshlerinin yerine konur (çarpışma dünyası üretilen geometriden
   olduğu gibi kalır). Malzemeler oyunun kendi malzemeleridir (ad = anahtar), klonlanıp `aoMap` (+ `aoMap.channel=1`,
   `aoMapIntensity` ≈ 1) eklenir; özel gölgelendiriciler (`onBeforeCompile`) korunur. Zemin arazi gölgelendiricisine
   dünya xz ile `ground_ao` örneklemesi eklenir. srcHash eskiyse konsolda uyarı + canlı meshler (pişirmesiz).
5. **CI** `.github/workflows/bake-lighting.yml`: `workflow_dispatch` + veri/üretici değişince; `npm ci`, oyun derle,
   dışa aktar, `pip install bpy==4.2.0`, pişir, `public/bake/` commit et. Toplam boyut hedefi < 150 MB (KTX2/WebP).

## Ultra gerçekçilik paketi (gerçek zamanlı)

- Kademeli gölge haritası (CSM, 4 kademe, 4096²), PCSS/yumuşak gölge, yüksek çözünürlük; `devicePixelRatio` tam.
- Gerçek HDRI gökyüzü (Poly Haven CC0, bulutlu yaz öğleden sonrası — Street View kareleri parçalı bulutlu) hem arka
  plan hem ortam haritası; güneş yönü HDRI'deki güneşle hizalı; bulut gölgesi (yavaş kayan düşük frekanslı maske).
- Son işlem: TAA veya SMAA 2×, **film greni** (luma'ya bağlı, çok hafif, zamanla değişen), hafif kromatik sapma
  (kenarlarda), vinyet, lens bloom yalnız parlak kaynaklar, renk LUT'u (Street View kalibrasyonundan), keskinleştirme,
  isteğe bağlı hafif hareket bulanıklığı. Pozlama otomatik göz uyumu (gölgeye girince açılma).
- Ekran uzayı yansıma (SSR) camlarda ve ıslak zemin yok; cam için gerçekçi ortam küpü (bölgesel yeniden yakalama).
- Malzeme: cephe kiri/yağmur izi (pencere altı akıntı, zemine yakın kararma), asfalt yama/çatlak yalnız ölçülen yerde.
