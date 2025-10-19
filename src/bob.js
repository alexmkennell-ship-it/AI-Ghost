/* Bob v8.8 — Procedural Cowboy (visible + stable build)
   - No texture map; vertex color gradient by height
   - Keeps mic, speech, jaw flap, and animations
   - Minimal console output
*/

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

console.log("🟢 Bob v8.8 (procedural visible build) init");

// ---------- CONFIG ----------
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const DEFAULT_IDLE = "Neutral Idle";

// ---------- GLOBALS ----------
let scene, camera, renderer, clock, mixer, model, currentAction;
let recognition = null, isSpeaking = false;

// ---------- THREE.JS SETUP ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(2, 4, 3);
  scene.add(hemi, dir);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = controls.enablePan = false;

  clock = new THREE.Clock();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------- PROCEDURAL MATERIAL ----------
function colorizeByHeight(mesh) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes.position) return;

  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const vCount = pos.count;
  const colors = new Float32Array(vCount * 3);

  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < vCount; i++) {
    const y = pos.getY(i);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const range = maxY - minY;

  const bone = new THREE.Color(0xE8E2D2);
  const denim = new THREE.Color(0x3F6A8F);
  const boots = new THREE.Color(0x6A4B2A);
  const hat = new THREE.Color(0x6E4625);

  const tmp = new THREE.Color();
  for (let i = 0; i < vCount; i++) {
    const t = (pos.getY(i) - minY) / range;
    if (t > 0.85) tmp.copy(hat);
    else if (t > 0.5) tmp.copy(denim);
    else if (t > 0.2) tmp.copy(boots);
    else tmp.copy(bone);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  mesh.geometry = g;
  mesh.material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.15,
  });
}

// ---------- MODEL ----------
async function loadRig() {
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + "T-Pose.fbx");
  fbx.scale.setScalar(1);
  scene.add(fbx);
  model = fbx;

  fbx.traverse((o) => {
    if (o.isMesh) colorizeByHeight(o);
  });

  mixer = new THREE.AnimationMixer(model);
  return model;
}

const cache = {};
async function loadClip(name) {
  if (cache[name]) return cache[name];
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + encodeURIComponent(name) + ".fbx");
  const clip = fbx.animations[0];
  cache[name] = clip;
  return clip;
}

async function play(name = DEFAULT_IDLE) {
  if (!mixer) return;
  const clip = await loadClip(name);
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  if (currentAction) currentAction.crossFadeTo(action, 0.4, false);
  action.play();
  currentAction = action;
  console.log("🤠 Bob action:", name);
}

// ---------- AI SPEECH ----------
async function say(text) {
  if (isSpeaking) return;
  isSpeaking = true;
  try {
    recognition?.stop();
    const resp = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "onyx" }),
    });
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      isSpeaking = false;
      recognition?.start();
    };
    await audio.play();
  } catch (err) {
    console.warn("⚠️ TTS failed:", err);
    isSpeaking = false;
  }
}

async function askBob(prompt) {
  const resp = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await resp.json();
  const reply = data.reply || "Well shoot, reckon I’m tongue-tied, partner.";
  await say(reply);
}

// ---------- MIC ----------
function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return console.warn("SpeechRecognition not supported");
  recognition = new SR();
  recognition.continuous = true;
  recognition.lang = "en-US";
  recognition.onresult = (e) => {
    const text = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    if (!isSpeaking) askBob(text);
  };
  recognition.onend = () => {
    if (!isSpeaking) recognition.start();
  };
  recognition.start();
  console.log("🟢 Mic active");
}

// ---------- LOOP ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  renderer.render(scene, camera);
}

// ---------- MAIN ----------
async function initBob() {
  try {
    initThree();
    await loadRig();
    await play(DEFAULT_IDLE);
    document.body.addEventListener("click", () => {
      if (!recognition) initSpeech();
    }, { once: true });
    animate();
  } catch (err) {
    console.error("❌ Boot failed:", err);
  }
}

setTimeout(() => {
  console.log("🐎 Booting Bob (procedural visible)...");
  initBob();
}, 2000);
