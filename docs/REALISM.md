# Gerçekçilik planı — "gerçekten mahallemde gibi"

Kullanıcı (2026-09-29): "Bana gerçeğe en yakın hissi vermeli. Gerekirse mobilden açılmayacak kadar ağır olsun, sağlam
bir PC GPU'su gereksin." Bu dosya neyin neden yapıldığını/yapılacağını sıralar. Ayrıntılı ışık hattı: `BAKE.md`.

## Neden bir 3D sahne "sahte" görünür? (algıya etkisine göre sıralı)

1. **Işık taşınımı.** Dolaylı ışık / gökyüzü örtünmesi eksikse her şey düz ve "yapıştırılmış" görünür; ortam ışığı
   güneşe göre fazlaysa soluk/pastel görünür (Eylül'de kalibre edildi: ortam ~2× fazlaydı). Gerçek güneş 0.53°'lik
   bir disk: gölge teması keskin, uzaklaştıkça yumuşar (20 m'lik binanın gölge kenarı ~19 cm bulanık, 3 m'deki
   balkonunki ~3 cm). Tek tip keskin/bulanık gölge en belirgin CG işaretidir.
2. **Kusursuzluk.** Gerçek sokakta her daire farklıdır (perde, panjur, klima, çanak, cam balkon), sıva yamalıdır,
   pencere altları akıntılıdır, zemin birleşimi kirlidir, camlar tam düzlem değildir (her camda yansıma biraz
   bükülür). Hepsi ölçümle (Street View) gelir; genel yıpranma fiziksel süreçten (yağmur, toz) türetilir, hasar
   uydurulmaz (CLAUDE.md §0).
3. **Malzeme tepkisi.** Doğru albedo (fotoğraftan), pürüzlülük farkları, Fresnel, pah kırılmış kenarlarda parlama
   (keskin 90° kutu kenarı = CG). Göz hizasında zeminin gerçek dokusu (kilit taşı deseni, bordür, asfalt tanesi).
4. **Kamera/sensör.** Beyin "fotoğraf" diye okur: gren (karanlıkta daha çok), hafif kromatik sapma ve vinyet,
   parlak kaynaklarda taşma, güneşe bakınca parlama, gölgeye girince göz uyumu, yumuşak parlak ton sıkıştırması,
   titremeyen kenarlar (TAA / süper örnekleme). Görüş açısı: geniş açı sokakları olduğundan geniş gösterir.
5. **Atmosfer.** Uzaklık pusu (Bursa havası genelde puslu), Uludağ'ın puslu silüeti, bulut gölgeleri.
6. **Hayat.** Yürüyen insanlar, arabalar, sallanan ağaçlar, kayan bulutlar, dalgalanan bayraklar, uçuşan güvercin
   sürüleri, açık pencerede kıpırdayan perde.
7. **Ses.** Varlık hissinin yarısı: zemine göre ayak sesi, bina arası yankı, geçen araçlar, kuşlar (serçe, kumru),
   uzakta köpek, site avlusunda çocuklar, Bursaray, gerçek vakitlerde gerçek camiden ezan.
8. **İnsan ölçeği.** Göz yüksekliği, doğal görüş açısı, adımla senkron baş salınımı, gerçekçi yürüme hızı.

## Yapılanlar / sürenler / sıradakiler

| Alan      | Kalem                                                                                                                                       | Durum                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Işık      | Gündüz ışığı Street View'a kalibre (71 yama, güneş/gölge oranı, nötr ton)                                                                   | ✅                            |
| Işık      | Blender Cycles pişirilmiş dolaylı ışık oranı → `aoMap` (yalnız dolaylı ışık; güneş gerçek zamanlı) + üstten zemin AO                        | 🔄 ajan                       |
| Işık      | Kademeli gölge (CSM) + güneş diski boyutunda temas-sertleşen yumuşak gölge (PCSS)                                                           | 🔄 Ultra ajanı                |
| Işık      | Gerçek HDRI gökyüzü (parçalı bulutlu) + kayan bulut gölgeleri                                                                               | 🔄 Ultra ajanı                |
| Işık      | Yansıma sondası (camlar karşı binayı yansıtsın)                                                                                             | 🔄 Ultra ajanı                |
| Işık      | Dinamik nesneler (yaya, araç, oyuncu) için pişirilmiş ışık: zemin AO'dan ortam ölçeği, sonra SH sonda ızgarası (Cycles 360° küçük kareler)  | ⏳ pişirme sonrası            |
| Işık      | Gece pişirmesi: sokak lambası + pencere ışığının cephe/zemindeki izi (ayrı ışık haritası, gece katsayısıyla)                                | ⏳                            |
| Işık      | Renkli sekme (turuncu bandın beyaz duvara yansıması): RGB dolaylı oran                                                                      | ⏳                            |
| Kamera    | TAA, film greni, kromatik sapma, vinyet, göz uyumu (otomatik pozlama), uzaklık pusu                                                         | 🔄 Ultra ajanı                |
| Kamera    | Güneşe bakınca lens parlaması (hafif, telefon kamerası gibi), fotoğraf modunda alan derinliği                                               | ⏳                            |
| Kamera    | 1. şahısta 55° dikey görüş açısı + adımla senkron baş salınımı (topuk vuruşunda en alçak)                                                   | ✅                            |
| Malzeme   | Cephe kiri: pencere altı akıntı, zemine yakın sıçrama kararması, yatay yüzeylerde toz                                                       | 🔄 Ultra ajanı                |
| Malzeme   | Gerçek zemin dokuları Street View'dan (kilit taşı deseni/ölçüsü, kırmızı bant, kılavuz şerit, bordür, asfalt) + derinlik (paralaks)         | 🔄 ajan                       |
| Malzeme   | Cam başına hafif eğiklik (yansıma bükülmesi), camda leke/toz pürüzlülüğü                                                                    | ⏳                            |
| Malzeme   | Pencere arkasında derinlik (iç mekân paralaksı: yalnız oda derinliği/tavan, eşya uydurulmaz)                                                | ⏳                            |
| Geometri  | Pah kırılmış kenarlar: balkon döşemesi, denizlik, harpuşta, bordür (Ultra)                                                                  | ⏳ üretici                    |
| Geometri  | Eski ölçümler (15 blok + çevre sokakları) Doğan Avcıoğlu standardına: kat kat balkon/perde/renk                                             | 🔄 ajanlar (13/15 bina bitti) |
| Geometri  | Üretici v6: perde rengi, çatı pencereleri, ferforje parmaklık, balkon altı spot, duvar aplikleri, bayraklar… (`pending` listeleri)          | ⏳                            |
| Bitki     | Gerçek ağaç türleri (servi, leylandi, palmiye, çam, çınar, ıhlamur, akasya…) — Street View'da görülenler                                    | 🔄 ajan                       |
| Hayat     | Güvercin sürüleri, dalgalanan bayraklar, açık pencerede perde                                                                               | ⏳                            |
| Hava      | "Gerçek hava" (Open-Meteo, tarayıcıdan): bulutluluk, rüzgâr, yağmur → ıslak zemin, su birikintisi yansıması, yağmur sesi                    | ⏳ Ultra sonrası              |
| Ses       | Gerçek kayıtlar (CC0/CC-BY, Actions ile), HRTF uzamsal ses, bina arası yankı, araç başına motor sesi, Bursaray, kuşlar, gerçek vakitte ezan | 🔄 ajan                       |
| Doğrulama | Eleştirmen döngüsü: aynı Street View noktasından oyun görüntüsü ↔ fotoğraf, bağımsız ajan                                                   | sürekli                       |

## Doğrulama ilkesi

Her kalem Street View / yer fotoğrafıyla aynı noktadan karşılaştırılır (`compare.tmp.mjs` + görüş listeleri,
`docs/compare/`). Ölçülebilen her şey ölçülür (renk ΔE, güneş/gölge oranı, desen ölçüsü); "daha güzel" değil "daha
gerçek" hedeflenir.
