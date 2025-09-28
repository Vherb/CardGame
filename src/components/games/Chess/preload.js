import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

THREE.Cache.enabled = true;

let inFlight = null;

export function preloadChessModels() {
  if (inFlight) return inFlight;
  const gltfLoader = new GLTFLoader();
  const names = ['pawn','rook','knight','bishop','queen','king'];
  inFlight = Promise.all(
    names.map(name => new Promise((resolve) => {
      try { gltfLoader.load(`/models/chess/${name}.glb`, () => resolve(true), undefined, () => resolve(true)); }
      catch { resolve(true); }
    }))
  ).finally(() => { /* keep resolved promise for future calls */ });
  return inFlight;
}

export function resetChessPreload() { inFlight = null; }
