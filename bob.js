// bob.js — v4.0.2 "FBX Personality Engine (Safe Global)"
// Uses global THREE + FBXLoader from HTML script
// Smooth animation blending, idle variety, sleep, TTS, and gestures.

/////////////////////////////////////////////////////
// CONFIGURATION
/////////////////////////////////////////////////////
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/";
const TEX_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

if (!window.THREE || !THREE.FBXLoader) {
  throw new Error("❌ THREE or FBXLoader not found. Ensure they are loaded before bob.js");
}

/////////////////////////////////////////////////////
// ANIMATIONS
/////////////////////////////////////////////////////
const FILES = {
  "Neutral Idle": "Neutral Idle.fbx",
  "Breathing Idle": "Breathing Idle.fbx",
  "Looking Around": "Looking Around.fbx",
  "Bored": "Bored.fbx",
  "Sad Idle": "Sad Idle.fbx",
  "Sleeping Idle": "Sleeping Idle.fbx",
  "Waking": "Waking.fbx",
  "Lying Down": "Lying Down.fbx",
  "Talking": "Talking.fbx",
  "Shrugging": "Shrugging.fbx",
  "Shaking Head No": "Shaking Head No.fbx",
  "Laughing": "Laughing.fbx",
  "Waving": "Waving.fbx",
  "Silly Dancing": "Silly Dancing.fbx",
};

const ANIM = {
  IDLE: "Neutral Idle",
  BREATH: "Breathing Idle",
  LOOK: "Looking Around",
  BORED: "Bored",
  SAD: "Sad Idle",
  LIE: "Lying Down",
  SLEEP: "Sleeping Idle",
  WAKE: "Waking",
  TALK: "Talking",
  SHRUG: "Shrugging",
  NO: "Shaking Head No",
  LAUGH: "Laughing",
  WAVE: "Waving",
  DANCE: "Silly Dancing",
};

const idlePool = [ANIM.IDLE, ANIM.BREATH, ANIM.LOOK, ANIM.BORED, ANIM.SAD];
const talkPool = [ANIM.TALK, ANIM.SHRUG, ANIM.NO, ANIM.LAUGH];
const funPool = [ANIM.DANCE, ANIM.WAVE];

/////////////////////////////////////////////////////
// UTILITIES
/////////////////////////////////////////////////////
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const setStatus = (m) => (document.getElementById("status").textContent = m);

/////////////////////////////////////////////////////
// THREE.JS CORE
/////////////////////////////////////////////////////
let scene, camera, renderer, mixer, clock;
let baseModel, jawBone = null, fingerBones = [], focusBone = null;
let state = "boot", micLocked = false, sleepLock = false;
let clipsCache = {}, fbxCache = {};
let cam = { radius: 5.8, yaw: 0, pitch: 1.3089969, target: new THREE.Vector3(0, 1.2, 0) };

async function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, cam.radius);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(2, 4, 3);
  scene.add(dir);

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/////////////////////////////////////////////////////
// LOADERS
/////////////////////////////////////////////////////
async function loadBaseModel() {
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[ANIM.IDLE]);
  fbx.scale.setScalar(0.01);
  scene.add(fbx);
  baseModel = fbx;

  const tex = await new THREE.TextureLoader().loadAsync(TEX_URL);
  tex.flipY = false;
  baseModel.traverse((o) => {
    if (o.isMesh) {
      o.material.map = tex;
      o.material.needsUpdate = true;
    }
    if (o.isBone && /jaw|chin/i.test(o.name)) jawBone = o;
    if (o.isBone && /(finger|thumb|hand|wrist)/i.test(o.name)) fingerBones.push(o);
    if (o.isBone && /head|neck|spine2/i.test(o.name)) focusBone = o;
  });

  mixer = new THREE.AnimationMixer(baseModel);
  if (fbx.animations?.length) clipsCache[ANIM.IDLE] = fbx.animations;
}

async function loadClipsFor(name) {
  if (clipsCache[name]) return clipsCache[name];
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
  fbxCache[name] = fbx;
  const clips = (fbx.animations || []).map((c) => c.clone());
  clipsCache[name] = clips;
  return clips;
}

/////////////////////////////////////////////////////
// PLAYBACK + CAMERA
/////////////////////////////////////////////////////
let currentAction = null;

async function play(name, fade = 0.4, loop = true) {
  if (!mixer) return;
  const clips = await loadClipsFor(name);
  if (!clips.length) return;
  const clip = clips[0];
  const newAction = mixer.clipAction(clip);
  newAction.reset();
  newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  newAction.clampWhenFinished = !loop;
  if (currentAction) currentAction.crossFadeTo(newAction, fade, false);
  newAction.play();
  currentAction = newAction;
}

function updateCamera() {
  cam.yaw += Math.sin(performance.now() * 0.00015) * 0.002;
  const r = cam.radius, y = cam.pitch, xz = r * Math.cos(y);
  camera.position.set(
    cam.target.x + xz * Math.sin(cam.yaw),
    cam.target.y + r * Math.sin(y),
    cam.target.z + xz * Math.cos(cam.yaw)
  );
  camera.lookAt(cam.target);
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  const dt = clock.getDelta();
  mixer?.update(dt);
  updateCamera();
  renderer.render(scene, camera);
}

/////////////////////////////////////////////////////
// AUDIO-DRIVEN JAW + FINGERS
/////////////////////////////////////////////////////
function driveAmplitude(audio) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
  const src = ctx.createMediaElementSource(audio);
  src.connect(analyser); analyser.connect(ctx.destination);
  const data = new Uint8Array(analyser.fftSize);
  function tick() {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / data.length);
    const amp = Math.min(rms * 7, 1);
    if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, -amp * 0.5, 0.35);
    for (const b of fingerBones) if (b.rotation) b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, amp * 0.2, 0.25);
    requestAnimationFrame(tick);
  }
  tick();
}

/////////////////////////////////////////////////////
// SPEECH + ANIMATION
/////////////////////////////////////////////////////
async function speakAndAnimate(text) {
  if (!text) return;
  state = "talking"; setStatus("💬 Thinking...");
  await play(pick(talkPool), 0.25, true);

  const chat = await fetch(`${WORKER_URL}/`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: text }),
  });
  const data = await chat.json();
  const reply = data.reply || "Well, partner, reckon I'm all outta bones to pick.";
  console.log("🤖", reply);

  const r = await fetch(`${WORKER_URL}/tts`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: reply, voice: "onyx" }),
  });
  if (!r.ok) return;
  const buf = await r.arrayBuffer();
  const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
  audio.playbackRate = 0.9; audio.preservesPitch = false;

  micLocked = true; if (window.recognition) try { window.recognition.stop(); } catch {}
  audio.addEventListener("play", () => driveAmplitude(audio), { once: true });
  await audio.play().catch(() => {});
  audio.onended = async () => {
    micLocked = false; if (window.recognition) try { window.recognition.start(); } catch {}
    state = "idle"; setStatus("👂 Listening...");
    await play(pick(idlePool), 0.35, true);
  };
}

/////////////////////////////////////////////////////
// MICROPHONE + IDLE
/////////////////////////////////////////////////////
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
  window.recognition = rec;

  rec.onresult = async (e) => {
    const t = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    console.log("🎤", t);
    if (state === "sleeping" && /hey\s*bob/.test(t)) return await wakeUp();
    await speakAndAnimate(t);
  };

  rec.onend = () => { if (!micLocked) rec.start(); };
  window.addEventListener("click", () => { try { rec.start(); setStatus("👂 Mic on…"); } catch {} }, { once: true });
}

/////////////////////////////////////////////////////
// BOOT
/////////////////////////////////////////////////////
async function boot() {
  console.log("🟢 Booting Bob (v4.0.2 safe)");
  setStatus("Loading Bob...");
  await initThree();
  await loadBaseModel();
  await play(ANIM.IDLE, 0.4, true);
  renderLoop();
  setStatus("👂 Listening...");
  console.log("🎉 Bob ready!");
}
window.addEventListener("DOMContentLoaded", boot);
