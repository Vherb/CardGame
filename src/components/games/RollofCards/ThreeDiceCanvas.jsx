// src/components/games/RollofCards/ThreeDiceCanvas.jsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  World, Box, Body, Plane, Vec3, Quaternion, Material, ContactMaterial, SAPBroadphase
} from "cannon-es";

export default function ThreeDiceCanvas({
  target1 = 1,
  target2 = 1,
  animateKey = 0,
  height = 260,
  onSettle,
  settleSleepMs = 300,
  biasToTargets = false,

  // Camera/look (top-down-ish)
  fov = 45,
  cameraY = 10.5,
  cameraZ = 0.001,

  // Dice / table
  dieSize = 0.9,
}) {
  const mountRef = useRef(null);

  // Three/Cannon refs
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const worldRef = useRef(null);

  const die1Ref = useRef(null);
  const die2Ref = useRef(null);

  const rafIdRef = useRef(0);
  const resizeObsRef = useRef(null);
  const settleTimerRef = useRef(null);
  const lastEmitKeyRef = useRef(0);

  // Face mapping (keep your original mapping):contentReference[oaicite:4]{index=4}
  const faceIndexToValue = [3, 4, 1, 6, 2, 5];

  // Local normals for each face in BoxGeometry order
  const localNormals = [
    new THREE.Vector3( 1, 0, 0), // +X
    new THREE.Vector3(-1, 0, 0), // -X
    new THREE.Vector3( 0, 1, 0), // +Y (top)
    new THREE.Vector3( 0,-1, 0), // -Y (bottom)
    new THREE.Vector3( 0, 0, 1), // +Z
    new THREE.Vector3( 0, 0,-1), // -Z
  ];
  const worldUp = new THREE.Vector3(0, 1, 0);

  const topValueForBody = (body) => {
    const q = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    let bestDot = -Infinity;
    let bestFace = 2; // default to +Y
    for (let i = 0; i < 6; i++) {
      const n = localNormals[i].clone().applyQuaternion(q);
      const d = n.dot(worldUp);
      if (d > bestDot) { bestDot = d; bestFace = i; }
    }
    return faceIndexToValue[bestFace];
  };

  // Build a round pip texture 1..6
  const makePipTex = (dots) => {
    const s = 256;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#111111";
    const rad = 24;
    const pos = {
      tl:[s*0.25,s*0.25], tr:[s*0.75,s*0.25],
      ml:[s*0.25,s*0.50], mm:[s*0.50,s*0.50], mr:[s*0.75,s*0.50],
      bl:[s*0.25,s*0.75], br:[s*0.75,s*0.75]
    };
    const map = {
      1:["mm"],
      2:["tl","br"],
      3:["tl","mm","br"],
      4:["tl","tr","bl","br"],
      5:["tl","tr","mm","bl","br"],
      6:["tl","ml","bl","tr","mr","br"]
    };
    (map[dots] || []).forEach((k) => {
      const [x,y] = pos[k];
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI*2); ctx.fill();
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  const buildMaterials = () => {
    // Order must match faceIndexToValue logic: [3,4,1,6,2,5]
    const faces = [makePipTex(3), makePipTex(4), makePipTex(1), makePipTex(6), makePipTex(2), makePipTex(5)];
    return faces.map((t) => new THREE.MeshStandardMaterial({ map: t, metalness: 0.05, roughness: 0.6 }));
  };

  const createDie = (scene, world, size, laneX = -0.9, dynamic = true) => {
    const geom = new THREE.BoxGeometry(size, size, size);
    const mats = buildMaterials();
    const mesh = new THREE.Mesh(geom, mats);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    scene.add(mesh);

    const half = size / 2;
    const shape = new Box(new Vec3(half, half, half));
    const body = new Body({
      mass: dynamic ? 1 : 0,
      shape,
      position: new Vec3(laneX, dynamic ? 2.8 : 3.0, (Math.random() - 0.5) * 1.0),
      angularDamping: 0.35,
      linearDamping: 0.42,
      allowSleep: true,
    });
    world.addBody(body);

    return { mesh, body };
  };

  const sync = (die) => {
    die.mesh.position.set(die.body.position.x, die.body.position.y, die.body.position.z);
    die.mesh.quaternion.set(die.body.quaternion.x, die.body.quaternion.y, die.body.quaternion.z, die.body.quaternion.w);
  };

  const randomizeKick = (die) => {
    die.body.velocity.set((Math.random() - 0.5) * 5.2, -0.35, (Math.random() - 0.5) * 5.2);
    die.body.angularVelocity.set((Math.random() - 0.5) * 34, (Math.random() - 0.5) * 34, (Math.random() - 0.5) * 34);
    die.body.wakeUp();
  };

  const quatForTop = (val) => {
    const q = new Quaternion(0,0,0,1);
    const rx = new Quaternion(); const rz = new Quaternion();
    switch (val) {
      case 1: break;
      case 2: rz.setFromEuler(0, 0, -Math.PI/2, "XYZ"); q.mult(rz, q); break;
      case 3: rz.setFromEuler(0, 0,  Math.PI/2, "XYZ"); q.mult(rz, q); break;
      case 4: rx.setFromEuler( Math.PI, 0, 0, "XYZ");  q.mult(rx, q); break;
      case 5: rx.setFromEuler(-Math.PI/2, 0, 0, "XYZ"); q.mult(rx, q); break;
      case 6: rx.setFromEuler( Math.PI/2, 0, 0, "XYZ"); q.mult(rx, q); break;
      default: break;
    }
    return q;
  };

  const gentleGuideTo = (die, value, strength = 0.1) => {
    const tgt = quatForTop(value);
    const cur = die.body.quaternion;
    const qFrom = new THREE.Quaternion(cur.x, cur.y, cur.z, cur.w);
    const qTo   = new THREE.Quaternion(tgt.x, tgt.y, tgt.z, tgt.w);
    const qOut  = new THREE.Quaternion().slerpQuaternions(qFrom, qTo, strength);
    die.body.quaternion.set(qOut.x, qOut.y, qOut.z, qOut.w);
  };

  const tryEmitSettle = () => {
    const die1 = die1Ref.current;
    const die2 = die2Ref.current;
    if (!die1 || !die2) return;

    const v1 = die1.body.velocity, w1 = die1.body.angularVelocity;
    const v2 = die2.body.velocity, w2 = die2.body.angularVelocity;

    const still =
      v1.length() < 0.05 && w1.length() < 0.05 &&
      v2.length() < 0.05 && w2.length() < 0.05;

    if (!still) {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }
    if (settleTimerRef.current) return;

    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      const emitKey = lastEmitKeyRef.current;
      lastEmitKeyRef.current = emitKey + 1;

      const d1 = topValueForBody(die1.body);
      const d2 = topValueForBody(die2.body);
      onSettle?.({ d1, d2 });
    }, settleSleepMs);
  };

  const throwDice = () => {
    const die1 = die1Ref.current;
    const die2 = die2Ref.current;
    if (!die1 || !die2) return;

    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }

    [die1, die2].forEach((d, i) => {
      d.body.velocity.set(0,0,0);
      d.body.angularVelocity.set(0,0,0);
      const laneX = i === 0 ? -0.9 : 0.9;
      d.body.position.set(laneX, 2.8 + Math.random() * 0.8, (Math.random() - 0.5) * 1.0);
      d.body.quaternion.setFromEuler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    });

    randomizeKick(die1);
    setTimeout(() => randomizeKick(die2), 160);
  };

  // Init / mount
  useEffect(() => {
    const mount = mountRef.current;
    const width = mount?.clientWidth || 600;
    const h = height;

    // THREE
    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(fov, width / h, 0.1, 100);
    camera.position.set(0, cameraY, cameraZ);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, h);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, cameraY, 3);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    scene.add(dir);

    // CANNON
    const world = new World({ gravity: new Vec3(0, -9.82, 0) });
    world.broadphase = new SAPBroadphase(world);
    world.allowSleep = true;
    world.defaultContactMaterial.friction = 0.35;
    world.defaultContactMaterial.restitution = 0.35;

    const feltMat = new Material("felt");
    const diceMat = new Material("dice");
    world.addContactMaterial(new ContactMaterial(diceMat, feltMat, { friction: 0.35, restitution: 0.45 }));
    world.addContactMaterial(new ContactMaterial(diceMat, diceMat, { friction: 0.3, restitution: 0.2 }));

    // Table (visual invisible; opacity 0 keeps floor invisible):contentReference[oaicite:5]{index=5}
    const tableGeo = new THREE.PlaneGeometry(8, 8);
    const tableMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0a6a2f"),
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = false;
    scene.add(table);

    // Table physics
    const tableBody = new Body({ mass: 0, material: feltMat, shape: new Plane() });
    tableBody.type = Body.STATIC;
    tableBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(tableBody);

    // Walls (physics only)
    const mkWall = (pos, rotY) => {
      const wall = new Body({ mass: 0, material: feltMat, shape: new Plane() });
      wall.type = Body.STATIC;
      wall.position.set(pos.x, pos.y, pos.z);
      wall.quaternion.setFromEuler(0, rotY, 0);
      world.addBody(wall);
    };
    const r = 3.2;
    mkWall({ x: 0, y: 0, z: -r }, 0);
    mkWall({ x: 0, y: 0, z: +r }, Math.PI);
    mkWall({ x: -r, y: 0, z: 0 }, Math.PI / 2);
    mkWall({ x: +r, y: 0, z: 0 }, -Math.PI / 2);

    // Dice
    const die1 = createDie(scene, world, dieSize, -0.9, true);
    const die2 = createDie(scene, world, dieSize,  0.9, true);
    die1.body.material = diceMat;
    die2.body.material = diceMat;

    // Save refs
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    worldRef.current = world;
    die1Ref.current = die1;
    die2Ref.current = die2;

    // Animate loop
    const clock = new THREE.Clock();
    const animate = () => {
      const dt = Math.min(clock.getDelta(), 1/30);
      world.step(1/60, dt, 3);

      if (biasToTargets) {
        const v1 = die1.body.velocity.length();
        const w1 = die1.body.angularVelocity.length();
        const v2 = die2.body.velocity.length();
        const w2 = die2.body.angularVelocity.length();
        const slowish = (v1 < 0.3 && w1 < 0.6) && (v2 < 0.3 && w2 < 0.6);
        if (slowish) {
          gentleGuideTo(die1, target1, 0.04);
          gentleGuideTo(die2, target2, 0.04);
        }
      }

      sync(die1);
      sync(die2);
      tryEmitSettle();

      camera.position.set(0, cameraY, cameraZ);
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      rafIdRef.current = requestAnimationFrame(animate);
    };
    animate();

    // Resize
    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth || 600;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    if (mount) ro.observe(mount);
    resizeObsRef.current = ro;

    return () => {
      if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
      cancelAnimationFrame(rafIdRef.current);
      try { resizeObsRef.current?.disconnect(); } catch {}
      try {
        scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose?.();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
            else obj.material.dispose?.();
          }
        });
        renderer.dispose?.();
        mount?.removeChild(renderer.domElement);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount

  // Re-throw dice when animateKey changes
  useEffect(() => {
    if (!die1Ref.current || !die2Ref.current) return;
    lastEmitKeyRef.current = (lastEmitKeyRef.current || 0) + 1;
    setTimeout(() => { /* ensure world is stepped */ throwDice(); }, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey]);

  return (
    <div ref={mountRef} style={{ width: "100%", height, position: "relative" }}>
      {/* Dice glyph overlay for phones (optional): handled by WebGL canvas */}
    </div>
  );
}
