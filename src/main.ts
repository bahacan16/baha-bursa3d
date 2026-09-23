import './hud/hud.css';
import { loadSettings } from './core/settings';
import { Game } from './game';
import { BoxesWorld } from './worlds/boxes';

const app = document.getElementById('app')!;
const settings = loadSettings();
const debug = new URLSearchParams(location.search).has('debug');

const game = new Game(app, settings);
game.setWorld(new BoxesWorld());
void game.character.load(`${import.meta.env.BASE_URL}models/RobotExpressive.glb`);
game.start();
if (debug) (window as unknown as { __game: Game }).__game = game;
