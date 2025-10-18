// 🟢 Bob v8.7 — Full GitHub-Ready Cowboy
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/controls/OrbitControls.js";

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const TEXTURE_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

let scene, camera, renderer, clock, mixer, model, currentAction;
let recognition, asleep = false, isSpeaking = false;

// ---------- THREE.JS SETUP ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.65);
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(2, 4, 3);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-2, 2, -2);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(0, 3, -3);
  scene.add(hemi, key, fill, rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.update();

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------- TEXTURE ----------
async function applyTexture(fbx) {
  const loader = new THREE.TextureLoader();
  const tex = await loader.loadAsync(TEXTURE_URL);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;

  fbx.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({
        map: tex,
        metalness: 0.25,
        roughness: 0.55,
        envMapIntensity: 0.8,
        emissive: o.name.toLowerCase().includes("eye")
          ? new THREE.Color(0x00ff66)
          : new THREE.Color(0x000000),
        emissiveIntensity: o.name.toLowerCase().includes("eye") ? 0.15 : 0,
      });
      o.material.needsUpdate = true;
    }
  });
}

// ---------- MODEL ----------
async function loadRig() {
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + "T-Pose.fbx");
  fbx.scale.setScalar(1);
  scene.add(fbx);
  model = fbx;
  await applyTexture(fbx);

  mixer = new THREE.AnimationMixer(model);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  camera.lookAt(center);
  return model;
}

// ---------- ANIMATIONS ----------
const cache = {};
async function loadClip(name) {
  if (cache[name]) return cache[name];
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + encodeURIComponent(name) + ".fbx");
  const clip = fbx.animations[0];
  cache[name] = clip;
  return clip;
}

async function play(name) {
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
    recognition.stop();
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
      recognition.start();
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
  console.log("💬 Bob says:", reply);
  await say(reply);
}

// ---------- MIC ----------
function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.lang = "en-US";

  recognition.onresult = (e) => {
    const text = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    console.log("🗣️ You said:", text);
    if (text.includes("hey bob") && asleep) {
      asleep = false;
      play("Neutral Idle");
      say("Mornin’, partner. You woke me up from a dead nap!");
      return;
    }
    if (!asleep && !isSpeaking) askBob(text);
  };

  recognition.onend = () => {
    if (!isSpeaking) recognition.start();
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

// ---------- MAIN BOOT SEQUENCE ----------
async function initBob() {
  console.log("🟢 Bob v8.7 init");
  try {
    initThree();
    await loadRig();
    await play("Neutral Idle");
    document.body.addEventListener(
      "click",
      () => {
        if (!recognition) initSpeech();
        console.log("🎤 Mic activated");
      },
      { once: true }
    );
    animate();
  } catch (err) {
    console.error("❌ Boot failed:", err);
  }
}

// ---------- 3-SECOND GITHUB DELAY ----------
setTimeout(() => {
  console.log("🐎 GitHub delay complete — booting Bob...");
  initBob();
}, 3000);
