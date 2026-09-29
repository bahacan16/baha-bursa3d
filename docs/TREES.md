# Ağaç türü kütüphanesi

Bu belge oyundaki her ağacın hangi gerçek türe göre çizildiğini, türün Street View karesinde (640 px) nasıl
tanındığını, bölgede örneklenen renkleri ve kanıt karelerini listeler. Kod: `src/worlds/osm/species.ts` (anahtarlar,
ayrıştırma), `treelib.ts` (modeller), `leafcards.ts` (yaprak kartı atlası), `treemesh.ts` (uzak silüetler),
`treefield.ts` (örnekleme + LOD), `vegetation.ts` (yerleştirme).

Kaynaklar: Street View 2025-09 kareleri (`streetview-src/mertkent-2-etap`, `streetview-src/extra`; güneşli),
kullanıcı fotoğrafları `streetview-src/user/` (2026-09, bulutlu/yağmurlu), ölçüm verisi
`src/worlds/mertkent/data/{site,park,street}-plan.json`.

**Kural (CLAUDE.md §0.1):** tür yalnızca görülen ağaca yazılır. Görülmeyen ağaç genel anahtarla kalır
(`deciduous`, `conifer`, `deciduous-oval`) ve aşağıda "görülmedi" diye listelenir.

## Tür anahtarları

Renkler sRGB, `scripts/sample-foliage.mjs` ile: kare içindeki yaprak piksellerinin (gök/beyaz cephe/çok koyu hariç)
parlaklık sırasına göre **güneşli** = en parlak %15, **orta** = %40–60, **gölge** = %10–25 ortalaması. "bulutlu"
yazanlar kullanıcı fotoğraflarından (genel ışık düşük). Yaprak kartı albedosu güneşli değerin ~%85'i alındı
(ışık Street View'a kalibre).

| Anahtar                       | Türkçe / Latince                                                                                   | 640 px SV karesinde tanıma                                                                                                       | Bölgede boy / taç Ø    | Yaprak rengi (güneşli / orta / gölge)                                                                  | Kabuk                     | Kanıt kareleri                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cedrus`                      | Himalaya sediri — _Cedrus deodara_                                                                 | geniş piramit; yataya yakın, uçları sarkık yumuşak katlar (katlar arası boşluk kenarda görünür); tepe sürgünü bir yana eğik      | 7–10 m / 2.5–7.6 m     | #94a57c–#a3b689 / #4b5b36–#5e7045 / #1b2912–#2e3e1c (Y11WZ 255, h329R2 302); bulutlu #859472 / #3b4130 | koyu gri, ince çatlaklı   | Y11WZ_255_10_40, h329R2_302_11_40 (büyük sedir), ybQK_60_0, CrRB_120_0, otng_181_-5_40, otng_174_21_40, Oh3BP_153_11_40, jeMF_127_5_40, yz6q_92_-5_40; kullanıcı: site-oyun-parki, site-kamelya-yolu |
| `picea-pungens`               | mavi ladin — _Picea pungens_ 'Glauca'                                                              | küçük, sık, simetrik sert koni; çimle karşıtlıkta gümüşi mavi                                                                    | 2.5–4 m / 1.8–2.4 m    | gümüşi mavi-yeşil (örnek çimle karışık; kart #7e958f–#9bb0a9)                                          | gri-kahve                 | d_xiN_0_0, TRTBV_300_0                                                                                                                                                                               |
| `goldcrest`                   | limoni servi — _Cupressus macrocarpa_ 'Goldcrest' tipi (budanmamış leylandi konisi)                | yumuşak alev biçimli koni, limon-sarımsı yeşil, yukarı kalkık tüysü sürgün uçları                                                | 2–3 m (sıralar), 5–6 m | bulutlu #788540 / #384411 / #172106; aynı cins leylandi çit (SV) #9fb864 / #516e31 / #1c330d           | —                         | kullanıcı: site-a-blok, site-kamelya-yolu, site-oyun-parki, site-otopark-c, site-havuz-yolu (site içi SV'de görünmez); 9qNH_0_-5_40 (çit rengi)                                                      |
| `cupressus`                   | Akdeniz servisi — _Cupressus sempervirens_                                                         | dar, koyu, dikey sütun                                                                                                           | 6–15 m / 1–2 m         | — (bölgede SV'de doğrulanmadı)                                                                         | kahve                     | yok — tek nokta (-11.8, -72) hava fotoğrafı taç izinden; **görülmedi**                                                                                                                               |
| `thuja`                       | mazı / doğu mazısı — _Thuja_ / _Platycladus_ (ölçüm notunda "konik ardıç")                         | küçük, parlak yeşil, sivri yumurta-koni, yere kadar yapraklı; dikey yassı pullu sürgünler (ardıç olsa iğnemsi ve mavimsi olurdu) | 1.2–1.8 m / ~1.1 m     | #769441 / #253f19 / #152a12 (2ydcI 183)                                                                | —                         | 2ydcI_183_8_40, 77ue_273_-5_40, cn-4g_313_-15_40, 7xGS_141_-15_40 (KD köşe adası)                                                                                                                    |
| `trachycarpus`                | Çin yelpaze palmiyesi — _Trachycarpus fortunei_                                                    | ince, lifli koyu gövde; uzun saplı, derin yarıklı yelpaze yapraklar; alt yapraklar yatık/sarkık                                  | 3–4 m / ~3 m           | #687b5a / #30452b / #182c15 (1Jme 46); bulutlu #818c71 / #42492c / #262c17                             | koyu kahve lif örtüsü     | 1Jme_46_4_40, jeMF_127_5_40, yz6q_92_-5_40; kullanıcı: site-a-blok, site-ic-yol                                                                                                                      |
| `tilia`                       | ıhlamur — _Tilia_ (gümüşi alt yüzler: _T. tomentosa_ olası)                                        | yoğun yumurta-oval taç; kalp biçimli dişli yapraklar, rüzgârda açık alt yüzler                                                   | 6–8 m / 5–6 m          | #abb576 / #546032 / #283614 (kgyF 240); bulutlu #9eb686 / #4f643c / #2d3f1d                            | gri, sığ çatlaklı         | kgyF_240_11_40; kullanıcı: site-kamelya                                                                                                                                                              |
| `ulmus`                       | karaağaç / çitlembik tipi geniş kubbe — _Ulmus_ / _Celtis_                                         | kısa kalın gövde, alçaktan çatallanan kollar, geniş kubbe, ince sık yapraklar                                                    | 9–15 m / 7–15 m        | #859165 / #39422a / #1e2811 (EbG300 120, gölge tarafı)                                                 | koyu gri, derin çatlaklı  | EbG300_120_0, joaQ_60_0                                                                                                                                                                              |
| `robinia`                     | yalancı akasya — _Robinia pseudoacacia_                                                            | düzensiz, açık taç; tüysü açık yeşil yapraklar                                                                                   | 8–12 m / 6–8 m         | #abbc7d / #6a8042 / #455922 (8QlT 60)                                                                  | kahve-gri, derin çatlaklı | 8QlT_60_0 (park kenarı; ölçülmüş noktayla eşleşmedi)                                                                                                                                                 |
| `robinia-globe`               | top akasya — _R. pseudoacacia_ 'Umbraculifera'                                                     | ~2 m temiz gövde üstünde sık küre taç, ince yaprak dokusu                                                                        | 4–5 m / 3–4 m          | #bacd73 / #6c832e / #364a0c (7xGS 0)                                                                   | kahve-gri                 | 7xGS_0_0, 2ydcI_300_0, 4RYu_60_0                                                                                                                                                                     |
| `koelreuteria`                | sabun ağacı — _Koelreuteria paniculata_ (orta güven)                                               | açık, düzensiz taç; tüysü dişli yaprakçıklar; Eylül'de tepede turuncu-kahve kapsül salkımları                                    | 6–9 m / 4–6 m          | #b4c78e / #819455 / #5f6f35 (7xGS 0)                                                                   | gri-kahve                 | 7xGS_0_0, 2ydcI_300_0, Oh3BP_60_0                                                                                                                                                                    |
| `prunus-purple`               | kan erik — _Prunus cerasifera_ 'Pissardii'                                                         | koyu şarap moru, küçük yapraklı yuvarlak taç                                                                                     | 5–8 m / 4–8 m          | — (bu çalışmada SV'de bulunamadı; ölçüm notu)                                                          | koyu kırmızımsı kahve     | ölçüm notu park-plan (-19.5, -171.9); kullanıcı site-havuz-bati (kamelya arkasında mor yapraklı bitki)                                                                                               |
| `eriobotrya`                  | yenidünya — _Eriobotrya japonica_                                                                  | dal uçlarında 20–30 cm mızraksı, derimsi koyu yaprak rozetleri; yuvarlak sık taç                                                 | 4–5 m / ~4.4 m         | #becc98 / #6c7749 / #253413 (BfxM 354)                                                                 | gri-kahve, düz            | BfxM_354_-4_40                                                                                                                                                                                       |
| `fruit`                       | meyve ağacı (tür belirsiz)                                                                         | küçük, gevşek yuvarlak taç; açık sarımsı yeşil yumurta yapraklar                                                                 | 4–5 m / 3–4 m          | #b0c37c / #65773b / #405221 (8QlT 194)                                                                 | gri-kahve                 | 8QlT_194_21_40, otng_181_-5_40 (KB meyve bahçesi)                                                                                                                                                    |
| `glossy`                      | parlak yapraklı her dem yeşil küçük ağaç (Photinia / Ligustrum / taflan tipi; tür ayırt edilemedi) | çok gövdeli, sık, koyu parlak eliptik yapraklar                                                                                  | 3–5 m / 3–4 m          | bulutlu #656f51 / #222812 / #0f1508 (havuz-bati), #68704e / #272e18 / #13170a (iç yol)                 | kırmızımsı kahve, düz     | kullanıcı: site-havuz-bati, site-ic-yol (konum ölçülmedi → veride kullanılmıyor)                                                                                                                     |
| `sapling`                     | kazıklı genç ağaç / fidan (tür görülmedi)                                                          | 5–8 cm ince gövde, seyrek küçük taç; Eylül'de yaprakların bir kısmı kahverengi                                                   | 2.5–5 m / 1–3 m        | orta #464520 (DIKa 180, kahve karışık)                                                                 | gri-kahve, düz            | DIKa_180_0, DIKa_120_0, 7xGS_207_9_40                                                                                                                                                                |
| `boxwood`                     | şimşir topu — _Buxus_                                                                              | budanmış koyu yeşil küre                                                                                                         | 0.6–1.2 m              | —                                                                                                      | —                         | anahtar hazır; ağaç verisinde henüz yok                                                                                                                                                              |
| `conifer`                     | genel iğne yapraklı (çam tipi)                                                                     | —                                                                                                                                | —                      | —                                                                                                      | —                         | tür görülmedi (hava fotoğrafı ağaçlarının ~%14'ü, OSM)                                                                                                                                               |
| `deciduous`, `deciduous-oval` | genel yaprak döken (yuvarlak / dik-oval)                                                           | —                                                                                                                                | —                      | —                                                                                                      | —                         | tür görülmedi                                                                                                                                                                                        |

Çitler (leylandi çit, yapay yaprak panel, şimşir çit) ağaç kütüphanesinde değil; site/çit katmanlarında
(`fence2.ts`, `site.ts`, `siteplan.ts` 'hedge').

## Modeller

| Üreteç | Türler                                                                                                                                                           | Nasıl                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ez     | deciduous, deciduous-oval, conifer, cedrus, picea-pungens, tilia, ulmus, robinia, robinia-globe, koelreuteria, prunus-purple, eriobotrya, fruit, glossy, sapling | ez-tree dallanması (`eztree.ts`) + eklenenler: **taç zarfı** (dal boyu zarfta kırpılır → top akasyanın küresi, ıhlamurun yumurtası, karaağacın kubbesi), **seviye başına yerçekimi** (sedirin sarkık kolları), **halka dizilimi** (sedir/ladin katları), **eğik tepe sürgünü** (sedir), temiz gövde için yaprak alt sınırı. Yaprak kartları çift çapraz dörtgen, türün atlas karosuyla. |
| shell  | goldcrest, cupressus, thuja, boxwood                                                                                                                             | Tür profili r(t) (alev, sütun, sivri yumurta, küre) üzerinde yukarı kalkık pullu sürgün kartları + koyu iç çekirdek (yakından içi dolu, kenarı yumuşak).                                                                                                                                                                                                                                |
| palm   | trachycarpus                                                                                                                                                     | Hafif eğik, üste doğru kalınlaşan lifli gövde (yordamsal lif dokusu) + tepede sap dipleri topuzu; 30 yelpaze yaprak altın açı sarmalında (gençler ~70° dik, yaşlılar yataya yakın, 6 kurumuş sarkık yaprak); her yaprak 5×8 ızgara: düz sap + V katlı, uca doğru sarkan aya; model ölçülen boya tekdüze ölçeklenir.                                                                     |

- **Yaprak kartları** (`leafcards.ts`): çalışma anında canvas'a çizilen 4×4 atlas (512 px karo): yumurta/kalp/
  eliptik/mızraksı yaprak biçimleri (sap, orta ve yan damar, dişli kenar, parlaklık, gümüşi alt yüz, Eylül
  sararması), tüysü bileşik yaprak, iğne tutamları, fırça sürgün, pullu sürgün yelpazesi, palmiye yelpazesi.
  Ön-çarpılmış alfa (kenarda siyah saçak yok) + mip düzeyine göre alfa ölçeği/keskinleştirme (uzakta taç
  seyrelmez).
- **Işık/renk**: tek yaprak malzemesi; köşe rengi = tür tonu × kart sapması × iç gölge (tacın içindeki kartlar
  ~%30 koyu; gölge haritası ayrıca karartır); tepe yüksekliğine göre sahte ortam kapanması, gündüz hafif ışık
  geçirgenliği.
- **Rüzgâr**: köşe `wind` çarpanı × tepe²: yaprak dökenler 0.8–1.1, iğne yapraklılar 0.3–0.55, palmiye 1.25
  (yaprak ucu en çok salınır).
- **LOD** (`treefield.ts`, ağaç başına, kamera 4 m yer değiştirince): yakın = tam model, orta = kartların
  %28–45'i (merkez etrafında büyütülmüş) + ana dallar, uzak = tür silüeti (katlı koni, sütun, yumurta, yıldız
  palmiye, gövdeli küre…). Yarıçaplar yakın/orta: Orta 65/130 m, Yüksek 100/180 m, **Ultra 140/260 m**; Düşük
  yalnız uzak silüet. Hata ayıklama: `?treelod=near|mid|far`.
- Yakın model üçgen sayıları (yaklaşık): sedir 10.7k, mavi ladin 8.6k, ıhlamur 8.8k, karaağaç 9.6k, top akasya
  9.1k, palmiye 3.1k, limoni servi 3.2k, mazı 1.5k, fidan 1.7k; orta 0.7–3.5k; uzak 30–400.

## Veri (anket ajanları için)

`species` alanına tür anahtarı ya da Türkçe/İngilizce/Latince ad yazılır (sözlük: `species.ts` RULES ve
`siteplan.ts` `speciesType` açıklaması). Tür alanı ile not çelişirse daha belirli olan kazanır (ör. `fruit` +
"Yenidünya" → `eriobotrya`; `deciduous` + "fidan" → `sapling`). Site planındaki `cone` noktaları `goldcrest`
(limoni servi) kabul edilir; iğne yapraklı `shrub` noktaları (mazı sırası) ve "genç ağaç" çalıları da ağaç
kütüphanesinde çizilir. Sokak planının 2 m altındaki `tree` noktaları artık küre değil türüne göre çizilir.

`fixedTrees` akışı: `[x, z, tür, boy m, taç yarıçapı m]` (0 = ölçülmedi); ölçek türün başvuru boyuna göre
(`vegetation.ts fixedScale`).

Bu çalışmada veride yapılan tür düzeltmeleri / eklemeler (kanıtları ilgili notlarda):

- site-plan: (-65.9, -140.4), (-66.8, -128.7), (-37.9, -135.8) `pine` → `cedrus`.
- site-plan **yeni**: Trachycarpus palmiyesi (-68.1, -62.6) h 3.6 r 1.5 (1Jme × jeMF üçgenleme, yz6q teyit);
  genç Himalaya sediri (-57.4, -62.7) h 7.4 (jeMF × yz6q).
- park-plan: (-21.5, -163.6) → `robinia-globe`; (-12.9, -165.8) ve (-16.5, -176.9) → `koelreuteria`.
- street-plan: `da1-tree-park-1` `cedar` → `picea-pungens`.

## Görülmedi / açık konular

- Site içi orta çimdeki 10 "küçük süs ağacı" (h 3) ve A1/B blok önü çalıların türü: site içi Street View'da
  görünmüyor. Kullanıcı fotoğraflarında bu çimlerde limoni servi konileri, parlak yapraklı çok gövdeli küçük
  ağaçlar, saksıda küçük bir yelpaze palmiyesi, yuvarlak çiçeklikte avizeli (yuka benzeri) bitki var; konumları
  ölçülmediği için eşlenmedi → genel yaprak döken.
- Güney kamelya çevresindeki iki ağaç (güneyde ıhlamur tipi, kuzeyde iri yuvarlak yapraklı) kullanıcı
  fotoğraflarında var, veride yok (konum ölçülmedi).
- (-11.8, -72) "ince servi": üç SV karesinde (kgyF 240, h329R2 313, Y11WZ 273) bu kerteriz büyük sedir ve
  ıhlamur tipi tacın arkasında; sütun servi görülmedi. Kullanıcı fotoğrafı (oyun parkı) yakınında genç bir sedir
  gösteriyor. Veri değiştirilmedi.
- Kuzey park: ölçülmüş 220 ağacın çoğu genel (`deciduous` / `sapling`). SV'de top akasya, sabun ağacı ve açık
  taçlı başka türler karışık; yalnız zemin teması ölçülmüş noktayla ≤2.4 m eşleşen üç ağaca tür yazıldı.
- (-19.5, -171.9) "mor/kızıl yapraklı" ağaç bakılan karelerde (Oh3BP 60, 8QlT 60, Xe8P 300, otng 60)
  görülemedi; ölçüm notuna göre `prunus-purple`.
- 6u321_60_0 karesinde GD'de bir bina köşesinde yelpaze palmiyesi var; konumu ölçülmedi.
- Hava fotoğrafı ağaçları (`trees-aerial.json`): tür ayrımı güvenilir değil → genel yaprak döken / iğne
  yapraklı (eski oran).
- Tek model/tür: aynı türün örnekleri döndürme, ölçek ve renk sapmasıyla çeşitlenir; yaşa bağlı biçim farkı yok.
