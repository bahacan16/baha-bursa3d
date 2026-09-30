/**
 * Oyunun başladığı yer (yerel metre). Koordinat sisteminin sıfır noktasından bağımsızdır.
 * KARAR (kullanıcı, 2026-09-30): gerçek veride Özlüce döner kavşağının güneybatı kaldırımı (ada merkezi
 * ≈629.6, −82.1); sentetik test verisinde (fixture) sıfır noktası.
 */
export const REAL_START = { x: 610, z: -62, label: 'Özlüce Döner Kavşağı (başlangıç)' };

export function startPoint(real: boolean): { x: number; z: number; label: string } {
  return real ? REAL_START : { x: 0, z: 0, label: 'Başlangıç' };
}
