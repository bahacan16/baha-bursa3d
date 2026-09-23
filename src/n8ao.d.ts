// n8ao tip bildirimi yok; kullandığımız alt küme.
declare module 'n8ao' {
  import type { Camera, Scene, WebGLRenderTarget, Color } from 'three';
  import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      autoRenderBeauty: boolean;
      gammaCorrection: boolean;
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
      color: Color;
      screenSpaceRadius: boolean;
      accumulate: boolean;
      transparencyAware: boolean;
    };
    beautyRenderTarget: WebGLRenderTarget;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
