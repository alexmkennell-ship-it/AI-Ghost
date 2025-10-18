// bob.js — v4.1.0 “No Imports Build”
// Fully standalone, using global THREE + FBXLoader
// Voice, animation, sleep cycle, and cinematic camera

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/";
const TEX_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

if (!window.THREE || !window.FBXLoader) {
  console.error("❌ THREE.js or FBXLoader not loaded. Check your HTML script includes.");
}

const FILES = {
  "Neutral Idle": "Neutral Idle.fbx",
  "Talking": "Talking.fbx",
  "Sleeping Idle": "Sleeping Idle.fbx",
  "Waking": "Waking.fbx",
  "Bored": "Bored.fbx",
  "Silly Dancing": "Silly Dancing.fbx",
  "Waving": "Waving.fbx",
};

const ANIM = {
  IDLE: "Neutral Idle",
  TALK: "Talking",
  SLEEP: "Sleeping Idle",
  WAKE: "Waking",
  BORED: "Bored",
  DANCE: "Silly Dancing",
  WAVE: "Waving",
};

let scene, camera, renderer, clock, mixer;
let model, currentAction, jawBone = null, fingerBones = [];
let cam = { radius: 5.8, yaw: 0, pitch: 1.31, target: new THREE.Vector3(0, 1.2, 0) };
let state = "boot", sleepLock = false, micLocked = false;
const setStatus = msg => (document.getElementById("status").textContent = msg);

// ----------------------------------------------------
// INITIALIZE
// ----------------------------------------------------
async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, cam.radius);

  const light = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
  scene.add(light);

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ----------------------------------------------------
// LOAD MODEL
// ----------------------------------------------------
async function loadModel() {
  const loader = new FBXLoader();
  const base = await loader.loadAsync(FBX_BASE + FILES[ANIM.IDLE]);
  base.scale.setScalar(0.01);
  scene.add(base);
  model = base;

  const tex = new THREE.TextureLoader().load(TEX_URL);
  tex.flipY = false;
  model.traverse(o => {
    if (o.isMesh) {
      o.material.map = tex;
      o.material.needsUpdate = true;
    }
    if (o.isBone && /jaw|chin/i.test(o.name)) jawBone = o;
    if (o.isBone && /(finger|thumb|hand|wrist)/i.test(o.name)) fingerBones.push(o);
  });

  mixer = new THREE.AnimationMixer(model);
  return base;
}

// ----------------------------------------------------
// ANIMATION
// ----------------------------------------------------
const clipsCache = {};
async function play(name, fade = 0.4, loop = true) {
  if (!mixer || !FILES[name]) return;
  if (!clipsCache[name]) {
    const fbx = await new FBXLoader().loadAsync(FBX_BASE + FILES[name]);
    clipsCache[name] = fbx.animations;
  }
  const clip = clipsCache[name][0];
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  if (currentAction) currentAction.crossFadeTo(action, fade, false);
  action.play();
  currentAction = action;
}

// ----------------------------------------------------
// CAMERA & RENDER
// ----------------------------------------------------
function updateCamera() {
  const r = cam.radius, y = cam.pitch, xz = r * Math.cos(y);
  cam.yaw += Math.sin(performance.now() * 0.0001) * 0.002;
  camera.position.set(xz * Math.sin(cam.yaw), r * Math.sin(y), xz * Math.cos(cam.yaw));
  camera.lookAt(cam.target);
}

function render() {
  requestAnimationFrame(render);
  const dt = clock.getDelta();
  mixer?.update(dt);
  updateCamera();
  renderer.render(scene, camera);
}

// ----------------------------------------------------
// VOICE / TTS
// ----------------------------------------------------
function startAmplitudeDriveFor(audio) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
  const src = ctx.createMediaElementSource(audio);
  src.connect(analyser); analyser.connect(ctx.destination);
  const data = new Uint8Array(analyser.fftSize);

  function tick() {
    analyser.getByteTimeDomainData(data);
    let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / data.length), amp = Math.min(rms * 7, 1);
    if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, -amp * 0.5, 0.25);
    for (const b of fingerBones) if (b.rotation) b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, amp * 0.22, 0.2);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function speakAndAnimate(text) {
  if (!text) return;
  setStatus("💬 Thinking...");
  state = "talking";
  await play(ANIM.TALK, 0.3);
  const resp = await fetch(`${WORKER_URL}/`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: text })
  });
  const data = await resp.json();
  const reply = data.reply || "Well shoot, reckon I’m tongue-tied.";
  const tts = await fetch(`${WORKER_URL}/tts`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: reply, voice: "onyx" })
  });
  const buf = await tts.arrayBuffer();
  const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
  audio.playbackRate = 0.92;
  micLocked = true;
  audio.addEventListener("play", () => startAmplitudeDriveFor(audio), { once: true });
  await audio.play().catch(() => {});
  audio.onended = async () => {
    micLocked = false;
    state = "idle";
    setStatus("👂 Listening...");
    await play(ANIM.IDLE, 0.4);
  };
}

// ----------------------------------------------------
// IDLE + SLEEP
// ----------------------------------------------------
async function fallAsleep() {
  if (state !== "idle" || sleepLock) return;
  sleepLock = true;
  state = "sleeping";
  setStatus("😴 Nodding off…");
  await play(ANIM.SLEEP, 0.6);
  cam.radius = 7.2;
}

async function wakeUp() {
  if (state !== "sleeping") return;
  cam.radius = 5.8;
  setStatus("😮 Waking up…");
  await play(ANIM.WAKE, 0.5);
  state = "idle"; sleepLock = false;
  setStatus("👂 Listening...");
}

// ----------------------------------------------------
// MICROPHONE
// ----------------------------------------------------
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.continuous = true; rec.lang = "en-US";
  rec.onresult = async e => {
    const t = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    if (state === "sleeping" && /hey\s*bob/.test(t)) return await wakeUp();
    await speakAndAnimate(t);
  };
  rec.onerror = e => console.warn("Mic error:", e.error);
  rec.onend = () => { if (!micLocked && state !== "sleeping") rec.start(); };
  window.addEventListener("click", () => { try { rec.start(); setStatus("👂 Listening (mic on)…"); } catch {} }, { once: true });
}

// ----------------------------------------------------
// BOOT
// ----------------------------------------------------
async function boot() {
  console.log("🟢 Booting Bob (standalone)...");
  await init();
  await loadModel();
  await play(ANIM.IDLE);
  render();
  state = "idle";
  setStatus("👂 Listening...");
  console.log("🎉 Bob ready!");
}
window.addEventListener("DOMContentLoaded", boot);
