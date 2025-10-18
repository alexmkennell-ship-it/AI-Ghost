// bob.js — v4.0.1 "FBX Personality Engine – Full Build"
// Loads FBX animations directly from R2
// Keeps single textured skeleton active with smooth crossfades
// Onyx TTS + amplitude-driven jaw/fingers
// Cinematic 5.8m camera (auto focus + drift)
// Idle variety, random skits, and 3-hour cached memory

/////////////////////////////////////////////////////
// CONFIGURATION
/////////////////////////////////////////////////////
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/";
const TEX_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

(async () => {
  // load Three.js and FBXLoader first
  const threeMod = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
  window.THREE = threeMod;
  Object.assign(window, threeMod);
  const { FBXLoader } = await import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/FBXLoader.js");
  THREE.FBXLoader = FBXLoader;

  // --- now load Bob
  await import("./bob_core.js");
})();

/////////////////////////////////////////////////////
// SAFE IMPORTS — FIXED THREE.js LOADING
/////////////////////////////////////////////////////
async function ensureThreeDeps() {
  // Load core Three.js
  if (!window.THREE) {
    const threeMod = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
    window.THREE = threeMod;
    Object.assign(window, threeMod);
  }

  // Load FBXLoader
  if (!THREE.FBXLoader) {
    const { FBXLoader } = await import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/FBXLoader.js");
    THREE.FBXLoader = FBXLoader;
  }
}

/////////////////////////////////////////////////////
// ANIMATION MAPS
/////////////////////////////////////////////////////
const FILES = {
  "Neutral Idle": "Neutral Idle.fbx",
  "Breathing Idle": "Breathing Idle.fbx",
  "Looking Around": "Looking Around.fbx",
  "Bored": "Bored.fbx",
  "Sad Idle": "Sad Idle.fbx",
  "Sleeping Idle": "Sleeping Idle.fbx",
  "Sleeping Idle (alt)": "Sleeping Idle (1).fbx",
  "Waking": "Waking.fbx",
  "Lying Down": "Lying Down.fbx",
  "Defeated": "Defeated.fbx",
  "Walking": "Walking.fbx",
  "Stop Walking": "Stop Walking.fbx",
  "Walkinglikezombie": "Walkinglikezombie.fbx",
  "Walkingsneakily": "Walkingsneakily.fbx",
  "Talking": "Talking.fbx",
  "Yelling": "Yelling.fbx",
  "Yelling Out": "Yelling Out.fbx",
  "Shrugging": "Shrugging.fbx",
  "Shaking Head No": "Shaking Head No.fbx",
  "Waving": "Waving.fbx",
  "Laughing": "Laughing.fbx",
  "Silly Dancing": "Silly Dancing.fbx",
};

const ANIM = {
  IDLE_NEUTRAL: "Neutral Idle",
  IDLE_BREATH: "Breathing Idle",
  IDLE_LOOK: "Looking Around",
  IDLE_BORED: "Bored",
  IDLE_SAD: "Sad Idle",
  LIE_DOWN: "Lying Down",
  SLEEP: "Sleeping Idle",
  SLEEP_ALT: "Sleeping Idle (alt)",
  WAKE: "Waking",
  DEFEATED: "Defeated",
  WALK: "Walking",
  WALK_STOP: "Stop Walking",
  WALK_ZOMBIE: "Walkinglikezombie",
  WALK_SNEAK: "Walkingsneakily",
  TALK: "Talking",
  YELL: "Yelling",
  YELL_OUT: "Yelling Out",
  SHRUG: "Shrugging",
  NO: "Shaking Head No",
  WAVE: "Waving",
  LAUGH: "Laughing",
  DANCE_SILLY: "Silly Dancing",
};

const idlePool = [
  ANIM.IDLE_NEUTRAL, ANIM.IDLE_BREATH, ANIM.IDLE_LOOK,
  ANIM.IDLE_BORED, ANIM.IDLE_SAD
];
const talkPool = [ANIM.TALK, ANIM.SHRUG, ANIM.NO, ANIM.LAUGH];
const funPool = [ANIM.DANCE_SILLY];
const walkPool = [ANIM.WALK, ANIM.WALK_ZOMBIE, ANIM.WALK_SNEAK];

/////////////////////////////////////////////////////
// UTILITIES
/////////////////////////////////////////////////////
const setStatus = (m) => { const e = document.getElementById("status"); if (e) e.textContent = m; };
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/////////////////////////////////////////////////////
// THREE.JS SETUP
/////////////////////////////////////////////////////
let scene, camera, renderer, clock, mixer;
let baseModel, currentAction = null, actions = {}, clipsCache = {}, fbxCache = {};
let jawBone = null, fingerBones = [], focusBone = null;
let state = "boot", micLocked = false, sleepLock = false;
let cam = { radius: 5.8, yaw: 0, pitch: 1.308996939, drift: true, target: new THREE.Vector3(0, 1.2, 0) };
let driftRAF = 0, renderRAF = 0;

async function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, cam.radius);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(2, 4, 3);
  scene.add(key);

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/////////////////////////////////////////////////////
// MODEL LOADING & TEXTURE
/////////////////////////////////////////////////////
async function loadBaseModel() {
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[ANIM.IDLE_NEUTRAL]);
  fbx.scale.setScalar(0.01);
  scene.add(fbx);
  baseModel = fbx;

  const tex = await new THREE.TextureLoader().loadAsync(TEX_URL);
  tex.flipY = false;
  baseModel.traverse(o => {
    if (o.isMesh) {
      o.material.map = tex;
      o.material.needsUpdate = true;
    }
    if (o.isBone && /jaw|chin/i.test(o.name)) jawBone = o;
    if (o.isBone && /(finger|thumb|hand|wrist)/i.test(o.name) && fingerBones.length < 10) fingerBones.push(o);
    if (o.isBone && /head|neck|spine2/i.test(o.name) && !focusBone) focusBone = o;
  });

  mixer = new THREE.AnimationMixer(baseModel);
  if (fbx.animations?.length) clipsCache[ANIM.IDLE_NEUTRAL] = fbx.animations;
}

async function loadClipsFor(name) {
  if (clipsCache[name]) return clipsCache[name];
  if (!FILES[name]) return [];
  if (!fbxCache[name]) {
    const loader = new THREE.FBXLoader();
    const fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
    fbxCache[name] = fbx;
  }
  const fbx = fbxCache[name];
  const clips = (fbx.animations || []).map(c => c.clone());
  clipsCache[name] = clips;
  return clips;
}

/////////////////////////////////////////////////////
// ANIMATION CONTROL
/////////////////////////////////////////////////////
async function play(name, { fade = 0.35, loop = true, minHold = 0.6 } = {}) {
  if (!mixer) return;
  const clips = await loadClipsFor(name);
  if (!clips.length) return;
  const clip = clips[0];
  const newAction = mixer.clipAction(clip);
  newAction.reset();
  newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  newAction.clampWhenFinished = !loop;
  newAction.enabled = true;

  if (currentAction) currentAction.crossFadeTo(newAction, fade, false);
  else newAction.fadeIn(fade);
  newAction.play();
  currentAction = newAction;
  if (minHold > 0) await sleepMs(minHold * 1000);
}

/////////////////////////////////////////////////////
// CAMERA + RENDER LOOP
/////////////////////////////////////////////////////
function updateCamera() {
  if (state === "idle" && cam.drift) cam.yaw += Math.sin(performance.now() * 0.00015) * 0.002;
  const r = cam.radius, y = cam.pitch, xz = r * Math.cos(y);
  camera.position.set(
    cam.target.x + xz * Math.sin(cam.yaw),
    cam.target.y + r * Math.sin(y),
    cam.target.z + xz * Math.cos(cam.yaw)
  );
  camera.lookAt(cam.target);
  if (focusBone?.getWorldPosition) {
    const p = new THREE.Vector3();
    focusBone.getWorldPosition(p);
    cam.target.lerp(p, 0.08);
  }
}

function startRender() {
  cancelAnimationFrame(renderRAF);
  const tick = () => {
    const dt = clock.getDelta();
    mixer?.update(dt);
    updateCamera();
    renderer.render(scene, camera);
    renderRAF = requestAnimationFrame(tick);
  };
  renderRAF = requestAnimationFrame(tick);
}

/////////////////////////////////////////////////////
// TTS + JAW MOVEMENT
/////////////////////////////////////////////////////
function startAmplitudeDriveFor(audio) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
    const src = ctx.createMediaElementSource(audio);
    src.connect(analyser); analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length), amp = clamp(rms * 7, 0, 1);
      if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, -amp * 0.5, 0.35);
      for (const b of fingerBones) if (b.rotation) b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, amp * 0.22, 0.25);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) { console.warn("Audio drive unavailable:", e); }
}

/////////////////////////////////////////////////////
// SPEECH SYSTEM
/////////////////////////////////////////////////////
async function speakAndAnimate(userText) {
  if (!userText) return;
  try {
    state = "talking";
    setStatus("💬 Thinking...");
    await play(pick(talkPool), { fade: 0.25, loop: true });
    const resp = await fetch(`${WORKER_URL}/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userText })
    });
    const data = await resp.json();
    const reply = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖", reply);
    const r = await fetch(`${WORKER_URL}/tts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "onyx" })
    });
    if (!r.ok) { state = "idle"; await play(ANIM.IDLE_NEUTRAL, { fade: 0.4 }); return; }
    const buf = await r.arrayBuffer();
    const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
    audio.playbackRate = 0.92; audio.preservesPitch = false;
    micLocked = true; if (window.recognition) try { window.recognition.stop(); } catch { }
    audio.addEventListener("play", () => startAmplitudeDriveFor(audio), { once: true });
    await audio.play().catch(() => { });
    audio.onended = async () => {
      micLocked = false; if (window.recognition) try { window.recognition.start(); } catch { }
      state = "idle"; setStatus("👂 Listening...");
      await play(pick([ANIM.IDLE_NEUTRAL, ANIM.IDLE_BREATH, ANIM.IDLE_LOOK]), { fade: 0.35 });
    };
  } catch (e) {
    console.error(e);
    state = "idle"; await play(ANIM.IDLE_NEUTRAL, { fade: 0.4 });
  }
}

/////////////////////////////////////////////////////
// SKIT ENGINE + IDLE LOGIC
/////////////////////////////////////////////////////
const SKITS = {
  [ANIM.IDLE_BORED]: ["Ain’t much goin’ on… just me and my thoughts rattlin’."],
  [ANIM.IDLE_LOOK]: ["Keepin’ an eye socket out for trouble."],
  [ANIM.DANCE_SILLY]: ["They call this one the Rattle-‘n-Roll!"],
  [ANIM.WAVE]: ["Howdy! Don’t mind the creaks—adds character."],
  [ANIM.WAKE]: ["Whoo-wee… dreamt I was a scarecrow with a 401K."],
};

async function saySkitFor(name) {
  const lines = SKITS[name]; if (!lines?.length) return;
  const line = pick(lines);
  const r = await fetch(`${WORKER_URL}/tts`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: line, voice: "onyx" })
  });
  if (!r.ok) return;
  const buf = await r.arrayBuffer();
  const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
  audio.playbackRate = 0.95; audio.preservesPitch = false;
  audio.addEventListener("play", () => startAmplitudeDriveFor(audio), { once: true });
  await audio.play().catch(() => { });
}

/////////////////////////////////////////////////////
// IDLE + SLEEP CYCLE
/////////////////////////////////////////////////////
async function fallAsleep() {
  if (state !== "idle" || sleepLock) return;
  sleepLock = true; state = "sleeping"; setStatus("😴 Nodding off…");
  await play(ANIM.LIE_DOWN, { fade: 0.45, loop: false });
  await play(ANIM.SLEEP, { fade: 0.45, loop: true });
  cam.radius = 7.2;
}

async function wakeUp() {
  if (state !== "sleeping") return;
  setStatus("😮 Waking up…");
  cam.radius = 5.8;
  await play(ANIM.WAKE, { fade: 0.45, loop: false });
  await play(ANIM.IDLE_NEUTRAL, { fade: 0.45, loop: true });
  state = "idle"; sleepLock = false; setStatus("👂 Listening...");
  saySkitFor(ANIM.WAKE);
}

function scheduleIdle() {
  const next = 12000 + Math.random() * 12000;
  setTimeout(async () => {
    if (state !== "idle") return scheduleIdle();
    let name = pick(idlePool);
    if (Math.random() < 0.1) name = pick(funPool);
    await play(name, { fade: 0.35 });
    saySkitFor(name);
    if (Math.random() < 0.08 && !sleepLock) await fallAsleep();
    scheduleIdle();
  }, next);
}

/////////////////////////////////////////////////////
// MICROPHONE
/////////////////////////////////////////////////////
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
  window.recognition = rec;
  rec.onresult = async (e) => {
    const t = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    if (!t) return;
    console.log("🎤", t);
    if (state === "sleeping" && /hey\s*bob/.test(t)) return await wakeUp();
    await speakAndAnimate(t);
  };
  rec.onerror = e => console.warn("Speech error:", e.error);
  rec.onend = () => { if (!micLocked && state !== "sleeping") rec.start(); };
  window.addEventListener("click", () => { try { rec.start(); setStatus("👂 Listening (mic on)…"); } catch { } }, { once: true });
}

/////////////////////////////////////////////////////
// BOOT
/////////////////////////////////////////////////////
async function boot() {
  console.log("🟢 Booting Bob 4.0.1 (FBX) …");
  setStatus("Loading Bob …");
  await ensureThreeDeps();
  await initThree();
  await loadBaseModel();
  await Promise.all([
    loadClipsFor(ANIM.IDLE_NEUTRAL),
    loadClipsFor(ANIM.TALK),
    loadClipsFor(ANIM.SLEEP),
    loadClipsFor(ANIM.WAKE)
  ]);
  await play(ANIM.IDLE_NEUTRAL);
  startRender();
  scheduleIdle();
  state = "idle"; setStatus("👂 Listening…");
  console.log("🎉 Bob ready!");
}

window.addEventListener("DOMContentLoaded",
