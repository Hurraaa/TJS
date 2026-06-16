# Modeller (CC0 .glb dosyaları)

Bu klasöre **license-free (CC0)** `.glb` dosyaları koyabilirsin; oyun bunları
otomatik algılayıp prosedürel (kodla çizilen) sürümlerin yerine kullanır.
Dosya yoksa kod kendi ev/ağaçlarını çizmeye devam eder — yani hiçbir şey bozulmaz.

## Desteklenen dosya adları
| Dosya | Ne yapar |
|-------|----------|
| `house.glb` | Tüm köy evlerini bu modelle değiştirir |
| `tree.glb`  | Ağaçları bu modelle değiştirir |

> Model otomatik olarak ~uygun boya ölçeklenir, tabanı zemine oturtulur ve
> oyunun toon (cel-shading) görünümüne çevrilir.

## Nereden CC0 model bulunur?
- **Quaternius** — https://quaternius.com (devasa CC0 low-poly doğa/bina paketleri)
- **Kenney** — https://kenney.nl (CC0 "Nature Kit", "City Kit")
- **Poly Pizza** — https://poly.pizza (binlerce CC0/CC-BY low-poly; "house", "tree" arat)
- **Kay Lousberg** — https://kaylousberg.com (CC0 kitler)

## Adımlar
1. Yukarıdaki sitelerden bir ev/ağaç modelini **glTF (.glb)** olarak indir.
2. Adını `house.glb` / `tree.glb` yap ve bu klasöre koy.
3. Commit + push et. GitHub Pages yayınlayınca model otomatik görünür.

İstersen birden çok çeşit (house2.glb, pine.glb vb.) ekleyelim — kodu ona göre
genişletirim; söylemen yeterli.
