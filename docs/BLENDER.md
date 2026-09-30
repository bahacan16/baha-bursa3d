# Nilüfer Walk → Blender (yerel oturum için devir notu)

> Bu dosyayı **bilgisayarındaki yerel Claude oturumuna** ver. O oturumun tek işi: Blender'a (Blender MCP üzerinden)
> bağlanıp bu projenin dünyasını **Blender Python arayüzüyle (bpy) sıfırdan kodla çizmek** ve proje ilerledikçe
> Blender sahnesini güncel tutmak. Oyunun geliştirmesi **bulut oturumunda devam ediyor**; yerel oturum oyunun
> kodunu değiştirmez.

---

## 1. Roller ve kurallar

|               | Bulut oturumu (geliştirme)                             | Yerel oturum (Blender köprüsü)                |
| ------------- | ------------------------------------------------------ | --------------------------------------------- |
| Ne yapar      | Oyunu geliştirir, ölçüm verisini üretir, dala push'lar | Aynı veriden Blender'da dünyayı bpy ile çizer |
| Dal           | `claude/basla-3g586x` (yayın: `main`)                  | **`blender-bridge`** (kendi dalı)             |
| Dokunduğu yer | `src/`, `public/`, `scripts/`, `docs/`…                | **Yalnızca `blender/`** klasörü               |

- `src/`, `public/`, `scripts/` altındaki hiçbir dosyayı değiştirme. Oyunun davranışı orada tanımlı; Blender tarafı onu
  **okur ve aynen taklit eder**. Oyun kodunda eksik/hatalı bir şey görürsen kullanıcıya söyle, düzeltmeyi bulut
  oturumu yapar.
- `claude/basla-3g586x` dalına asla push etme. Kendi işini `blender-bridge` dalına commit'le.
- `.blend` dosyaları ve render çıktıları repoya girmez: `blender/out/` (gitignore'a ekle).
- Kullanıcı Türkçe konuşur; yorumlar/notlar Türkçe olabilir.
- Gizli anahtar (Google API vb.) hiçbir dosyaya yazılmaz. Blender tarafının anahtara ihtiyacı yok.
- Kaynak gerçeği **TypeScript kodudur**: bir öğenin ölçüsü, rengi, dizilişi bpy'de tahmin edilmez; ilgili `.ts`
  dosyasından sabitleriyle birlikte aktarılır (bölüm 5). Görsel tercih gerekiyorsa `streetview-src/private/*.jpg`
  (yer fotoğrafları) ve `docs/compare/*.jpg` referanstır.

## 2. Kurulum

1. Repoyu klonla, dalı aç:
   ```bash
   git clone https://github.com/bahacan16/baha-bursa3d.git && cd baha-bursa3d
   git fetch origin claude/basla-3g586x
   git checkout -b blender-bridge origin/claude/basla-3g586x
   ```
2. Blender 4.2 LTS veya üstü.
3. **Blender MCP** (kullanıcı kuracak): Blender eklentisi + Claude Desktop'a MCP sunucusu. Kurulum adımlarını
   eklentinin kendi README'sinden doğrula (sürümler değişiyor). Bağlantı kurulunca önce basit bir test yap:
   bpy ile bir küp oluştur/sil, `bpy.app.version` oku.
4. MCP ile uzun kod göndermek yerine modülleri `blender/` altında dosya olarak yaz, Blender'da
   `sys.path`'e ekleyip `importlib.reload` ile çalıştır (MCP'den yalnızca kısa bir "çalıştır" çağrısı gider).
   Toplu/arka plan kurulum için: `blender --background --python blender/build.py -- --region mertkent`.
5. İsteğe bağlı: oyunun kendisini yerelde görmek için Node LTS → `npm ci && npm run build && npx vite preview`
   → `http://localhost:4173/?debug=1` (karşılaştırma için).

## 3. Koordinatlar ve birimler

- Birim **metre**. Orijin = `public/data/meta.json` → `center` (lat 40.2180548, lon 28.9073257; 502. Sokak orta
  noktası). Tüm veri dosyaları zaten bu merkeze göre yerel metre cinsinden.
- Oyun (three.js): **+x doğu, +y yukarı, +z güney** (−z kuzey).
- Blender: **+X doğu, +Y kuzey, +Z yukarı**. Dönüşüm:
  ```python
  def to_bl(x, y, z):   # oyun → Blender
      return (x, -z, y)
  ```
  2B halkalar (x, z) → Blender (x, −z). Dikkat: y ekseni ters döndüğü için **halka yönü (saat yönü) tersine
  döner**; yüz normallerini buna göre ayarla (ya da `bmesh.ops.recalc_face_normals`).
- Arazi: `public/data/terrain.bin`, `src/env/terrain.ts` → `parseTerrain`:
  - Başlık: 4 bayt `TRN1`, ardından 6 × float32 LE: `nearN, nearHalf, nearCell, farN, farHalf, farCell`
    (başlık toplam 28 bayt).
  - Sonra `nearN²` float32 (yakın ızgara, satır = z, sütun = x, `x = -half + i·cell`), ardından `farN²`
    float32 (uzak ızgara).
  - **Tüm yükseklikler yakın ızgaranın orta hücresinin değeri çıkarılarak** kullanılır (oyunda merkez ≈ 0 m).
  - Örnekleme çift doğrusaldır (`sampleGrid`); ızgara dışı kenar değeri.
- Bina oturma kotu: taban halkasının köşelerindeki **en düşük arazi yüksekliği** (oyunda `ringBase`).
- Hava fotoğrafı: `public/data/aerial-4096.jpg`, ±1300 m kare, **satır 0 = kuzey (z = −1300), sütun 0 = batı
  (x = −1300)**. Arazinin temel dokusu olarak kullanılır. Daha keskini site çevresi için
  `streetview-src/aerial/` (Google z21, 0.0667 m/px, x −160…240, z −330…70; `index.json`'da tanım).
- Kamera (karşılaştırma görüntüleri için): oyunda `heading` pusula açısı (0 = kuzey, 90 = doğu), `pitch`
  yukarı pozitif, `fov` **dikey** derece. Blender'da:
  ```python
  cam.rotation_euler = (radians(90 + pitch), 0, radians(-heading))
  cam.data.sensor_fit = 'VERTICAL'; cam.data.angle = radians(fov)
  ```
  Street View karelerinin kamera yüksekliği 2.5 m, yer fotoğrafları ≈ 1.5 m.

## 4. Veri kaynakları (hepsi repoda, bpy doğrudan okur)

| Dosya                                         | İçerik                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/data/meta.json`                       | Merkez, bbox, sayılar                                                                                                                                                                                                                                                                                    |
| `public/data/osm.json`                        | Sadeleştirilmiş OSM (±1200 m). `nodes: [{i, x, z, t}]`, `ways: [{i, p: [x0,z0,x1,z1,…], t: {etiketler}}]`, `rels: [{i, o: [dış halkalar], n: [iç halkalar], t}]`                                                                                                                                         |
| `public/data/terrain.bin`                     | Arazi (bölüm 3)                                                                                                                                                                                                                                                                                          |
| `public/data/aerial-4096.jpg` + `aerial.json` | Hava fotoğrafı                                                                                                                                                                                                                                                                                           |
| `public/data/trees-aerial.json`               | Hava fotoğrafından ağaç konumları                                                                                                                                                                                                                                                                        |
| `src/worlds/mertkent/data/footprints.json`    | Düzeltilmiş taban izleri `{osmId: {ring: [[x,z],…]}}`. **Köşe sırası sabittir**; cephe verisindeki kenar indeksleri bu sıraya bağlı                                                                                                                                                                      |
| `src/worlds/mertkent/data/facades.json`       | Ölçülmüş binaların derlenmiş cephesi (`CompiledBlock`, tip tanımı `src/worlds/mertkent/facade.ts`): kat sayısı, kat yüksekliği, `groundRaise`, çatı, renk paleti, kenar başına öğeler (`win`, `bal`, `strip`, `band`, `panel`, `pipe`, `ac`/`dish`/…, `entrance`), `massing` (podyum üstü ayrık kuleler) |
| `src/worlds/mertkent/survey/*.json`           | Ham ölçümler (compile girdisi; genelde facades.json yeterli)                                                                                                                                                                                                                                             |
| `src/worlds/mertkent/data/site-plan.json`     | Site içi: `areas` (çim, kilit taşı, güverte, havuz, oyun alanı, saha; `level`, `rail`, `gates`, `fence`), `lines` (çit, park çizgisi, bordür, kulvar), `structures` (kamelya, pergola, kulübe), `points` (ağaç, çalı, gül, servi, lamba, kova, oyun grubu, araç)                                         |
| `src/worlds/mertkent/data/street-plan.json`   | Sokak: `fence` (site çitleri), `gates`, `sidewalks` (bordür hattı + genişlik + katmanlar), `street` (direk, levha, bank, rögar…)                                                                                                                                                                         |
| `src/worlds/mertkent/data/park-plan.json`     | Parklar                                                                                                                                                                                                                                                                                                  |
| `public/textures/*`                           | Fotoğraf tabanlı PBR dokular (asfalt, beton, çim, sıva, çatı…); `public/textures/mk/` el modeli dokuları; `public/textures/trees/` ağaç yaprak dokuları                                                                                                                                                  |
| `streetview-src/private/*.jpg`                | Yer fotoğrafları (kaldırım tipi, site içi) — görsel referans                                                                                                                                                                                                                                             |
| `docs/compare/*.jpg`                          | Gerçek ↔ oyun karşılaştırmaları                                                                                                                                                                                                                                                                          |

## 5. Oyunda neyi hangi kod üretiyor → Blender'da karşılığı

Bu tablo port haritasıdır. Her satırda TS dosyasını oku, aynı algoritmayı ve **aynı sabitleri** bpy'ye aktar.

| Katman                                                | Oyun kaynağı                                                                                                                                                                                                                         | Not                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Arazi                                                 | `src/env/terrain.ts`, `src/worlds/osm/groundtex.ts`, `landuse.ts`                                                                                                                                                                    | 10 m ızgara mesh + hava fotoğrafı dokusu; alan kullanımı dokuya boyanır. Havuz vb. için delikler                                                |
| Uzak arazi / Uludağ                                   | `src/env/backdrop.ts`                                                                                                                                                                                                                | Uzak ızgara, düşük detay                                                                                                                        |
| Genel OSM binaları (2 km)                             | `src/worlds/osm/parse.ts` (yükseklik kuralları: `LEVEL_HEIGHT` 3.1, varsayılan 5 kat…), `buildings.ts` (duvar, parapet 0.8, çatı, çatı detayları), `facades.ts` (cephe atlası), `aerial.ts` (çatı rengi)                             | Hafif detay; önce bunları kaba kur                                                                                                              |
| Genel yollar/kaldırım                                 | `src/worlds/osm/roads.ts` (genişlik tablosu, bordür 0.15, kaldırım 2 m), `materials.ts` → `nilueferSidewalk`                                                                                                                         | Nilüfer kaldırımı: gri tuğla 10×20 (uzun kenar yol boyunca), ortada 40 cm sarı kılavuz                                                          |
| Raylar                                                | `src/worlds/osm/rail.ts`                                                                                                                                                                                                             |                                                                                                                                                 |
| Ölçülmüş binalar (Mertkent 2/3, Doğan Avcıoğlu, D4 …) | `src/worlds/mertkent/facade.ts` (+ `facadeMats.ts` malzemeler), `roof.ts` (kırma/beşik çatı birleşimi), `massing.ts` (podyum + kuleler)                                                                                              | En detaylı kısım: pencere boşlukları duvarda gerçekten açılır, doğrama/cam/panjur, balkon döşeme + korkuluk, şeritler, klima, çanak…            |
| El modeli özel yapılar                                | `apartment.ts`, `ozhan.ts` (Özhan Market), `salus.ts` (Salusvizyon), `site.ts` (site kapıları)                                                                                                                                       |                                                                                                                                                 |
| Site çitleri                                          | `fence2.ts` (Mertkent: dalgalı beyaz taş duvar, turuncu kolon + küre lamba, panel çit, leylandi, jiletli tel), `fenceGeneric.ts` (diğer siteler)                                                                                     | Veri: `street-plan.json` → `fence`                                                                                                              |
| Kaldırım / bordür / bisiklet yolu / sokak eşyası      | `street.ts` (`layoutOf`: bantlar, kılavuz, bisiklet şeridi; bordür `KERB_W` 0.15; lamba direği, levhalar, babalar, rögar, bank…)                                                                                                     | Veri: `street-plan.json`                                                                                                                        |
| Site içi                                              | `siteplan.ts` (alanlar, yükseltilmiş havuz platformu + buzlu cam korkuluk, havuzlar, çizgiler, yapılar, noktalar), `sitekit.ts` (kamelya, oyun grubu, panel çit, çift küreli lamba, çöp kovası, gül, servi, halı saha), `grounds.ts` | Veri: `site-plan.json`                                                                                                                          |
| Kilit taşı / kılavuz / kauçuk karo dokuları           | `facadeMats.ts` → `paverTextures`, `bonePaverTextures` (site içi "kemik" taş), `tactileTextures`; `textures.ts`                                                                                                                      | Canvas ile üretiliyor → Blender'da **shader node** ile yeniden kur veya aynı algoritmayla Python'da resim üret (`bpy.data.images.new` + piksel) |
| Ağaçlar                                               | `src/worlds/osm/vegetation.ts`, `treemesh.ts`, `eztree.ts` (dal + yaprak kartı; dokular `public/textures/trees/`)                                                                                                                    | Konumlar: site/park planı ağaçları + `trees-aerial.json`                                                                                        |
| Park etmiş araçlar                                    | `src/sim/carmodel.ts` (kodla loft gövde, Bursa "16" plakalar), `parked.ts`                                                                                                                                                           | Hareketli trafik/yaya Blender'da gerekmez                                                                                                       |
| Işık / renk                                           | `src/env/daylight.ts`, `lighting.ts`, `sky.ts`, `post.ts`                                                                                                                                                                            | Güneş az 165° / yükseklik 48° (Street View gölgelerinden); Blender'da Nishita gökyüzü + güneş, AgX                                              |

## 6. Blender tarafının yapısı (öneri)

```
blender/
  README.md          # nasıl çalıştırılır
  SYNC.md            # en son eşitlenen commit + neyin güncellendiği (bölüm 8)
  build.py           # giriş: argümanla bölge/katman seçimi, idempotent yeniden kurulum
  nw/
    io.py            # json/terrain.bin okuma, to_bl dönüşümü, ringBase
    terrain.py
    osm_buildings.py
    osm_roads.py
    mk_facade.py     # facades.json → binalar (facade.ts portu)
    mk_roof.py
    mk_street.py     # street-plan.json (street.ts portu)
    mk_fences.py
    mk_site.py       # site-plan.json (siteplan.ts + sitekit.ts portu)
    vegetation.py
    cars.py
    materials.py     # tüm malzemeler tek yerde, oyundaki anahtar adlarıyla (ör. 'spPaverGrey', 'tactile')
```

- **Koleksiyonlar:** `NW/Terrain`, `NW/OSM_Buildings`, `NW/Roads`, `NW/Mertkent/Blocks`,
  `NW/Mertkent/Street`, `NW/Mertkent/Site`, `NW/Vegetation`, `NW/Cars`. Her kurulum ilgili koleksiyonu
  silip yeniden oluşturur (idempotent).
- **Adlandırma:** `NW/<katman>/<osmId veya plan id>` → güncellemede tek bina/öğe yeniden kurulabilir.
- **Malzeme anahtarları oyundakiyle aynı** (`index.ts` → `materials()` içindeki adlar). Bir malzeme oyunda
  değişirse Blender'da tek yerden güncellenir.
- **Bölge:** önce ölçülmüş bölgenin bir parçası (x −200…300, z −350…150), sonra tüm 2 km (OSM kısmı düşük
  detay). Performans için aynı malzemeli parçaları nesne başına birleştir; ağaç/araç için instancing
  (collection instance veya geometry nodes).

## 7. Aşamalar (sırayla; her aşamada kullanıcıya görüntü göster, onay al)

0. Bağlantı testi (bölüm 2.3).
1. Arazi + hava fotoğrafı dokusu.
2. Genel OSM binaları ve yollar (kaba), Nilüfer kaldırımı.
3. Ölçülmüş bloklar (`facades.json`, `footprints.json`; Mertkent 2/3, Doğan Avcıoğlu, D4 …) — cephe öğeleri tam detay.
4. Sokak katmanı: kaldırım katmanları, bordür, mavi bisiklet yolu (502. Sk. Mertkent tarafı), çitler, kapılar,
   sokak eşyası.
5. Site içi: kemik kilit taşı + bordürler, yükseltilmiş havuz platformu (0.45 m traverten kaide, buzlu cam),
   havuzlar, kamelyalar, oyun parkı, halı saha, lambalar, bitkiler, park çizgileri (sarı).
6. Diğer ölçülmüş binalar (Salus, Özhan vb.) ve ağaçlar/araçlar.
7. Malzeme + ışık cilası.
8. Karşılaştırma renderları: `scripts/critic-views.json`, `scripts/critic-views-da1.json` (Street View pano
   konumu `streetview-src/mertkent-2-etap/index.json` → `panos[].x/z`, üstüne `dx`/`dz`), yer fotoğrafı
   kameraları (aşağıda). Aynı açıdan oyun görüntüsü + gerçek fotoğrafla yan yana koy.

Yer fotoğrafı kameraları (yaklaşık, eye 1.5 m; oyun koordinatı):

| Foto         | x     | z     | heading | pitch | fov |
| ------------ | ----- | ----- | ------- | ----- | --- |
| `ref-01.jpg` | 0.9   | −72   | 358     | −18   | 80  |
| `ref-04.jpg` | −39   | −57   | 2       | 3     | 85  |
| `ref-09.jpg` | −31.3 | −62.3 | 205     | 0     | 85  |
| `ref-10.jpg` | −24.2 | −72   | 90      | −5    | 85  |
| `ref-05.jpg` | −30.3 | −96   | 187     | 0     | 85  |
| `ref-06.jpg` | −30.5 | −141  | 180     | 0     | 85  |
| `ref-08.jpg` | −33   | −73.1 | 90      | 0     | 85  |

## 8. Senkronizasyon (geçmiş + gelecek)

**Değişiklik günlüğü: `docs/BLENDER_CHANGES.md`.** Bulut oturumu her commit'te oraya ne değiştiğini, hangi dosyaları
ve Blender'da hangi katmanın yeniden kurulacağını yazar. Eşitlerken önce onu oku; aşağıdaki git komutları yedek
kontrol içindir.

Geçmiş: şu anki dal ucu her şeyi içerir; ilk kurulum doğrudan bu veriden yapılır. Projenin tarihçesi ve
kararları için `CLAUDE.md` (özellikle §18 Faz durumu ve §18b Kararlar) oku.

Gelecek (bulut oturumu çalışmaya devam ettikçe):

```bash
git fetch origin claude/basla-3g586x
LAST=$(grep -m1 '^commit:' blender/SYNC.md | cut -d' ' -f2)
git log --oneline $LAST..origin/claude/basla-3g586x
git diff --stat $LAST..origin/claude/basla-3g586x -- src public/data scripts
git merge origin/claude/basla-3g586x   # blender-bridge dalına (çakışma olmaz: yalnız blender/ senin)
```

Değişen dosyaya göre yeniden kurulacak katman:

| Değişen                                                                                          | Blender'da                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `src/worlds/mertkent/data/facades.json`, `footprints.json`, `facade.ts`, `roof.ts`, `massing.ts` | İlgili bloklar (`NW/Mertkent/Blocks/<id>`) |
| `street-plan.json`, `street.ts`, `fence*.ts`, `site.ts`                                          | `NW/Mertkent/Street`                       |
| `site-plan.json`, `siteplan.ts`, `sitekit.ts`, `grounds.ts`                                      | `NW/Mertkent/Site`                         |
| `park-plan.json`                                                                                 | Parklar                                    |
| `public/data/*`                                                                                  | Arazi / OSM katmanları                     |
| `facadeMats.ts`, `textures.ts`, `index.ts` → `materials()`                                       | `materials.py`                             |
| `src/worlds/osm/*`                                                                               | Genel OSM katmanları                       |

Her eşitlemeden sonra `blender/SYNC.md`'ye `commit: <hash>` ve kısa not yaz, `blender-bridge`'e commit'le,
kullanıcıya önce/sonra render göster.

## 9. Bilinen tuzaklar

- Halka yönü: y eksenini ters çevirince (−z → +Y) saat yönü değişir (bölüm 3).
- `facades.json` kenar indeksleri `footprints.json` halkasının köşe sırasına bağlı; halkayı yeniden sıralama.
- `massing` olan blok (Doğan Avcıoğlu kuzey, 1550826982): zemin kat ortak, üstü iki kule; oyunda
  `massing.ts` → `splitMassing` halkayı x aralıklarıyla keser.
- Dükkân camları zemin kat döşemesinin altına inebilir (`groundRaise` sanal; `facade.ts` içinde
  `kind === 'shop'` durumu).
- Oyundaki bazı görünüşler gölgelendirici hilesidir (cephede gece pencere ışığı, cam iç mekân derinliği,
  yaprak rüzgârı): Blender'da gerçek geometri/malzemeyle karşılanmalı, birebir kopya aranmamalı.
- Hareketli sistemler (trafik, yayalar, gün döngüsü, ses) Blender kapsamı dışında.
