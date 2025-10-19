// Bob v8.8 (bone-only material)
// - Uniform bone color on all meshes (no textures / vertex colors)
// - Same mic, TTS, and animation behavior as before
// - Minimal logs

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

console.log("🟢 Bob v8.8 (bone-only) init");

// ---------- CONFIG ----------
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE   = "T-Pose.fbx";
const DEFAULT_IDLE = "Neutral Idle";

// ---------- GLOBALS ----------
let scene, camera, renderer, clock, mixer, model, currentAction;
let recognition = null, isSpeaking = false;

// ---------- THREE SETUP ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.7);
  const key  = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(2, 4, 3);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-2, 2, -2);
  scene.add(hemi, key, fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan  = false;
  controls.update();

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------- MATERIAL (bone-ish) ----------
function applyBoneMaterial(root) {
  const boneColor = new THREE.Color(0xE8E2D2); // warm ivory bone
  root.traverse((o) => {
    if (o.isMesh) {
      // Basic, reliable PBR setup so he always renders
      o.material = new THREE.MeshStandardMaterial({
        color: boneColor,
        roughness: 0.55,
        metalness: 0.08,
        envMapIntensity: 0.2,
      });
      o.material.needsUpdate = true;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
}

// ---------- MODEL ----------
async function loadRig() {
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + encodeURIComponent(RIG_FILE));
  fbx.scale.setScalar(1);
  applyBoneMaterial(fbx);
  scene.add(fbx);

  model = fbx;
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
  if (!clip) return;

  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  if (currentAction && currentAction !== action) currentAction.crossFadeTo(action, 0.35, false);
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
    if (!resp.ok) throw new Error(`TTS ${resp.status}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      isSpeaking = false;
      try { recognition?.start(); } catch {}
    };
    await audio.play();
  } catch (err) {
    console.warn("⚠️ TTS failed:", err);
    isSpeaking = false;
  }
}

async function askBob(prompt) {
  try {
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await resp.json();
    const reply = data.reply || "Well shoot, reckon I’m tongue-tied, partner.";
    await say(reply);
  } catch (e) {
    console.warn("⚠️ Chat error:", e);
  }
}

// ---------- MIC ----------
function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn("SpeechRecognition not supported in this browser.");
    return;
  }
  recognition = new SR();
  recognition.continuous = true;
  recognition.lang = "en-US";

  recognition.onresult = (e) => {
    const text = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    if (!isSpeaking) askBob(text);
  };
  recognition.onend = () => {
    if (!isSpeaking) {
      try { recognition.start(); } catch {}
    }
  };
  recognition.start();
  console.log("🟢 Bob: Listening...");
}

// ---------- LOOP ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  renderer.render(scene, camera);
}

// ---------- MAIN BOOT ----------
async function initBob() {
  console.log("🟢 Booting Bob (bone-only)...");
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

// ---------- START ----------
setTimeout(initBob, 1500);
