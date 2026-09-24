# Nilüfer Walk

Bursa / Nilüfer / 29 Ekim Mahallesi / **502. Sokak** merkezli, 2 km çaplı bir alanda tarayıcıda (masaüstü ve telefon) oynanan, **GTA tarzı üçüncü şahıs yürüyüşlü** 3D simülasyon. Binalar, yollar, ağaçlar gerçek 3D geometri olarak çizilir; kurulum gerektirmez.

## Nasıl oynanır

Siteyi aç → başlangıç ekranında modu seç:

|            | **Mod B — Oyun (varsayılan)**                                         | **Mod A — Gerçekçi**                                        |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Veri       | OpenStreetMap: bina şekilleri, kat sayıları, yollar, parklar, ağaçlar | Google Photorealistic 3D Tiles (Google Earth 3D verisi)     |
| Görünüm    | Temiz, oyun gibi; cepheler prosedürel                                 | Fotoğraf dokulu gerçek şehir; yakından "erimiş" görünebilir |
| Gereksinim | Hiçbir şey                                                            | Kendi Google Maps API anahtarın (aşağıya bak)               |

### Kontroller

| Masaüstü               |                                                                              |
| ---------------------- | ---------------------------------------------------------------------------- |
| `W A S D` / ok tuşları | Yürü (kamera yönüne göre)                                                    |
| Fare                   | Bak — ekrana tıklayınca fare kilitlenir                                      |
| `Shift`                | Koş                                                                          |
| `Space`                | Zıpla                                                                        |
| `V`                    | 1. şahıs ↔ 3. şahıs kamera                                                   |
| `M`                    | Büyük harita (tıkla → "Buraya ışınlan")                                      |
| `T`                    | Işınlanma menüsü (bilinen yerler)                                            |
| `Esc`                  | Duraklat / ayarlar                                                           |
| `H`                    | HUD aç/kapa                                                                  |
| `P`                    | Fotoğraf modu (serbest kamera, `Q`/`E` alçal/yüksel, `Space`/`F` PNG kaydet) |
| `Ctrl`                 | Hayalet adım: çarpışmasız 1 m ileri (sıkışınca)                              |

**Telefon:** ekranın sol yarısına dokun → joystick orada belirir (sonuna kadar itersen koşar). Sağ yarıda sürükle → kamera. Sağ alttaki butonlar: Zıpla (uzun bas = hayalet adım), Koş, Kamera, Harita. Yatay tutmak daha rahattır ama dikeyde de çalışır. Telefonda grafik kalitesi olarak **Düşük** önerilir.

### Neler gerçek, neler yaklaşık?

- **Gerçek (OpenStreetMap + açık yükseklik verisi):** bina konumları, taban şekilleri ve (etiketliyse) kat sayıları; tüm yollar ve adları; parklar, sahalar, site alanları, su; Bursaray hattı; işaretli ağaçlar, banklar, duraklar; arazinin eğimi ve uzaktaki Uludağ silüeti.
- **Hava fotoğrafından (Esri World Imagery):** zemin dokusu, her binanın çatı rengi (kiremit görülen binalara kırma çatı) ve ağaçların konumu (fotoğraftaki yeşil taçlardan otomatik tespit — yaklaşık).
- **Yaklaşık / prosedürel:** bina cepheleri (renk, pencere, balkon — OSM'de bu bilgi yok), kat bilgisi olmayan binalarda varsayılan 5 kat, ağaç türü/boyu, sokak lambalarının konumu, yayalar ve araçlar.

## Mod A: Google API anahtarı

Mod A, Google'ın **Map Tiles API**'sini kullanır; anahtar senin Google Cloud hesabına aittir ve kullanım senin kotandan düşer.

1. [Google Cloud Console](https://console.cloud.google.com/)'da bir proje oluştur ve **faturalandırmayı** etkinleştir (Google aylık ücretsiz kota verir; güncel ücretler için [Google Maps Platform fiyatlandırma](https://mapsplatform.google.com/pricing/) sayfasına bak).
2. **APIs & Services → Library → Map Tiles API** → _Enable_.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Anahtarı mutlaka kısıtla:
   - **Application restrictions → Websites (HTTP referrers):** `https://<kullanıcı-adın>.github.io/*` ve yerel geliştirme için `http://localhost:*`
   - **API restrictions → Restrict key → yalnızca "Map Tiles API"**
5. Anahtarı oyunun başlangıç ekranındaki alana yapıştır → **Kaydet**. Anahtar yalnızca senin tarayıcında (`localStorage`) saklanır; **Sil** ile kaldırabilirsin. Anahtar asla repoya yazılmaz.
6. Önce [Google Earth](https://earth.google.com/)'te bölgede 3D binalar görünüyor mu kontrol et; görünmüyorsa Mod A orada çalışmaz (oyun bunu fark edip Mod B'ye geçmeyi önerir).

Yerel geliştirmede `.env.local` dosyasına `VITE_GOOGLE_MAPS_KEY=...` yazarsan alan otomatik dolar (`.env.local` git'e girmez).

**Google politikaları:** Oyun, tile'lardan gelen telif atıflarını ve Google yazısını ekranda sürekli gösterir; tile'lar kalıcı olarak önbelleğe alınmaz/indirilmez. Ayrıntılar: [Map Tiles API Policies](https://developers.google.com/maps/documentation/tile/policies). _(Not: geliştirme ortamından bu sayfaya erişilemedi; resmî logo gerekliliği yayından önce bu sayfadan kontrol edilmeli.)_

## GitHub Pages'te yayınlama

1. `main` dalına push et (veya Actions sekmesinden _Deploy to GitHub Pages_ → _Run workflow_). İş akışı derlenmiş siteyi `gh-pages` dalına yayınlar.
2. GitHub'da repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `gh-pages` / `(root)`** (çoğu zaman GitHub bunu `gh-pages` dalı oluşunca kendisi açar; açmadıysa bu ayarı bir kez yap).
3. Site adresi: `https://<kullanıcı-adın>.github.io/<repo-adı>/`
4. İş akışı: bağımlılıklar → **OSM + arazi verisini çeker** (`npm run fetch-data`, `scripts/fetch-terrain.mjs`) → lint + testler → build → `gh-pages`. Veri çekme başarısız olursa commit edilmiş `public/data` kullanılır; o da yoksa oyun veriyi çalışırken tarayıcıdan Overpass'a sorar.

## Veri

- `scripts/fetch-osm.mjs`: önce `502. Sokak`'ı merkez etrafında 1.5 km içinde arar ve uzunluğunun orta noktasını merkez yapar (bulunamazsa `40.218262, 28.909611`), sonra merkez ± 1200 m alanı indirir, koordinatları yerel metreye çevirip sadeleştirir → `public/data/osm.json` + `meta.json`.
- Yerelde üretmek için: `npm run fetch-data` (ağ erişimi gerekir). İstersen çıktıyı commit edebilirsin (10 MB sınırı).
- `tests/fixtures/osm-small.json` **sentetik** test verisidir (gerçek harita değil); yalnızca ağ gerektirmeyen testler içindir.

## Geliştirme

```bash
npm install
npm run dev          # http://localhost:5173  (?mode=b doğrudan Mod B, ?debug=1 hata ayıklama)
npm run lint
npm run test         # birim testleri (Vitest)
npm run test:e2e     # duman testleri (Playwright, fixture verisiyle)
npm run build
```

`?debug=1` ile: `window.__game` kancası, FPS sayacında draw call/üçgen/bellek. `?world=boxes` Faz 1 test sahnesi. Mod A'da `?gcal=dx,dz` Google mesh'ine metre cinsinden kalibrasyon ofseti uygular.

## Lisanslar ve atıflar

- Harita verisi © [OpenStreetMap](https://www.openstreetmap.org/copyright) katkıcıları, ODbL.
- Mod A: Google Photorealistic 3D Tiles — Google ve veri sağlayıcılarının koşullarına tabidir.
- Karakter: **RobotExpressive** — Tomás Laulhé, CC0 (değişiklikler: Don McCurdy); three.js örneklerinden.
- Dokular (asfalt, kilitli parke, beton, sıva, kiremit, çim, toprak, ağaç kabuğu): [Poly Haven](https://polyhaven.com), **CC0**; yazarlar `public/textures/manifest.json`'da. `scripts/fetch-textures.mjs` ile Actions'ta indirilir.
- Ortam gölgelemesi: [N8AO](https://github.com/N8python/n8ao) (MIT).
- Draco çözücü: Google, Apache-2.0 (three.js ile gelir).
