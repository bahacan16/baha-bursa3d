import * as THREE from 'three';
import { createSky } from './env/sky';
import { createLighting } from './env/lighting';
import { loadSettings } from './core/settings';
import { GameLoop } from './core/loop';

const app = document.getElementById('app')!;
const settings = loadSettings();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
camera.position.set(0, 1.7, 5);
const sky = createSky(scene);
const lights = createLighting(scene, settings.quality);
lights.follow(new THREE.Vector3(), sky.sunDir);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2600, 2600).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x7d7a70, roughness: 1 }),
);
scene.add(ground);

new GameLoop({
  fixedUpdate: () => {},
  render: () => renderer.render(scene, camera),
}).start();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
