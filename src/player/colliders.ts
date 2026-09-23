import type * as THREE from 'three';

/**
 * Moddan bağımsız çarpışma dünyası arayüzü. Oyuncu kontrolcüsü yalnızca bunu bilir.
 * Konumlar oyuncunun ayak noktasıdır (Y yukarı).
 */
export interface ICollisionWorld {
  /**
   * Oyuncu kapsülünü (x/z düzleminde yarıçaplı daire) `pos`'tan (dx, dz) kadar hareket ettirir,
   * duvarlara çarpınca kaydırır. `pos` yerinde güncellenir.
   */
  moveHorizontal(pos: THREE.Vector3, dx: number, dz: number, radius: number): void;
  /**
   * (x, z) noktasındaki zemin yüksekliği. `feetY` basamak çıkma kararı için verilir.
   * `null` = veri yok (ör. tile yüklenmedi) → oyuncu dondurulur.
   */
  groundHeight(x: number, z: number, feetY: number): number | null;
  /** Kamera çarpışması: `from`'dan `dir` (birim) yönünde ilk isabet mesafesi, yoksa null. */
  raycast(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null;
}
