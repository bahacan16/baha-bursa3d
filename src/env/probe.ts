import * as THREE from 'three';
import { probeUniforms, reflectiveMaterials } from './ultra';

/**
 * Ultra: oyuncunun çevresini yakalayan yerel yansıma küresi (cam, araç boyası/camı, krom). Street View'da camlar
 * gökyüzünü değil karşı cepheyi, ağaçları ve sokağı yansıtır — sabit gökyüzü ortam haritası bunu veremiyordu.
 * Her kare 1 yüz (256²) çizilir → 6 karede tam güncelleme, sonra PMREM (pürüzlülüğe göre bulanık seviyeler).
 * KARAR: tek küre (oyuncu başı hizasında); uzak camlarda paralaks hatası kabul — sokak kanyonunda yön doğru.
 * Parlaklık fiziksel (sahnenin gerçek HDR ışıması) → yoğunluk 1.0; sahne ortam haritası kalibrasyonu etkilenmez
 * (yalnız kayıtlı yansıtıcı malzemeler bu haritayı kullanır, yayınık ışık yine kalibre gökyüzü haritasından).
 */
export class ReflectionProbe {
  private rt: THREE.WebGLCubeRenderTarget;
  private cube: THREE.CubeCamera;
  private face = 0;
  private pos = new THREE.Vector3();
  private pmremRT: THREE.WebGLRenderTarget | null = null;
  /** `?probe=1` açar (varsayılan kapalı, game.ts); değer yoğunluk çarpanı (boş → 1) */
  intensity = Number(new URLSearchParams(location.search).get('probe') || 1);

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly pmrem: THREE.PMREMGenerator,
    size = 256,
  ) {
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cube = new THREE.CubeCamera(0.3, 5000, this.rt);
    this.cube.coordinateSystem = renderer.coordinateSystem;
    this.cube.updateCoordinateSystem();
  }

  /** Bir yüz çiz; 6. yüzden sonra PMREM üret ve malzemelere ata. */
  update(scene: THREE.Scene, backdrop: THREE.Scene, at: THREE.Vector3, hide: THREE.Object3D[] = []): void {
    if (reflectiveMaterials.size === 0) return;
    const r = this.renderer;
    if (this.face === 0) {
      this.pos.copy(at);
      this.cube.position.copy(at);
      this.cube.updateMatrixWorld(true);
    }
    const cam = this.cube.children[this.face] as THREE.PerspectiveCamera;
    const prevTarget = r.getRenderTarget();
    const autoShadow = r.shadowMap.autoUpdate;
    // gölge haritası ana kamera için oturtulmuş haliyle kalsın (yüz başına yeniden çizme yok)
    r.shadowMap.autoUpdate = false;
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const sky = backdrop.getObjectByName('sky');
    // güneş diski yansımada olmasın: güneşin aynasal parıltısını SunLight zaten veriyor (çift sayım + perde)
    const su = (sky as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined;
    const disc = su?.uniforms?.showSunDisc?.value;
    if (su?.uniforms?.showSunDisc) su.uniforms.showSunDisc.value = 0;
    const skyPos = sky?.position.clone();
    sky?.position.copy(this.pos);
    r.setRenderTarget(this.rt, this.face);
    r.clear();
    r.render(backdrop, cam);
    r.clearDepth();
    r.render(scene, cam);
    if (sky && skyPos) sky.position.copy(skyPos);
    if (su?.uniforms?.showSunDisc) su.uniforms.showSunDisc.value = disc;
    hide.forEach((o, i) => (o.visible = vis[i]));
    r.shadowMap.autoUpdate = autoShadow;
    r.setRenderTarget(prevTarget);
    this.face = (this.face + 1) % 6;
    if (this.face === 0) {
      this.pmremRT = this.pmrem.fromCubemap(this.rt.texture, this.pmremRT ?? undefined);
      probeUniforms.uProbe.value = this.pmremRT.texture;
      probeUniforms.uProbeI.value = this.intensity;
      probeUniforms.uProbeReady.value = 1;
    }
  }

  dispose(): void {
    this.rt.dispose();
    this.pmremRT?.dispose();
  }
}
