# Ghibli Dünyası — Three.js

Tarayıcıda çalışan, üçüncü şahıs karakterle gezilebilen, **Ghibli/anime tarzı
stilize 3B açık dünya** demosu. Paylaşılan videodaki gibi cel-shading,
low-poly doğa ve yumuşak atmosfer hedeflenmiştir.

## Kullanılan teknikler
- **Cel / Toon shading** — `MeshToonMaterial` + gradient ramp (çizgi-film görünümü)
- **Low-poly + InstancedMesh** — binlerce çimen tek draw call ile
- **Atmosfer** — gradyan gökyüzü (custom shader), sis (fog), yumuşak gölgeler, bulutlar
- **Prosedürel arazi** — sinüs tabanlı yumuşak tepeler, üzerine oturan yol ve gölet
- **Üçüncü şahıs kontrolcü** — WASD hareket, koşma, zıplama, takip eden / sürüklenebilen kamera

## Çalıştırma
ES modülleri ve importmap kullandığı için dosyayı doğrudan `file://` olarak
değil, küçük bir yerel sunucu üzerinden açmak gerekir:

```bash
# Python 3 ile
python3 -m http.server 8080
# veya Node ile
npx serve .
```

Ardından tarayıcıda: <http://localhost:8080>

## Kontroller
| Tuş | Aksiyon |
|-----|---------|
| `W` `A` `S` `D` | Hareket |
| `Shift` | Koş |
| `Space` | Zıpla |
| Fare sürükle | Kamerayı döndür |
| Tekerlek | Yakınlaş / uzaklaş |

## Sıradaki adımlar (isteğe bağlı)
- Hazır karakter modeli (glTF) + iskelet animasyonları
- Su için yansıma/dalga shader'ı, gün-batımı zaman döngüsü
- Çarpışma (ağaç/ev), toplanabilir objeler, NPC'ler
- Post-processing (outline, bloom) ile daha güçlü anime görünümü
