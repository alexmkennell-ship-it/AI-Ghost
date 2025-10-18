// bob.js — Revision Safe Boot Version
// Assumes THREE + FBXLoader loaded globally first

////////////////////////////////////////////////////
// CONFIG
////////////////////////////////////////////////////
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/";
const TEX_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

////////////////////////////////////////////////////
// ANIMATION MAPS
////////////////////////////////////////////////////
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
  "Shrugging": "Shrugging.fbx",
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
  TALK: "Talking",
  SHRUG: "Shrugging",
  WAVE: "Waving",
  LAUGH: "Laughing",
  DANCE_SILLY: "Silly Dancing",
};

const idlePool = [ANIM.IDLE_NEUTRAL, ANIM.IDLE_BREATH, ANIM.IDLE_LOOK, ANIM.IDLE_BORED, ANIM.IDLE_SAD];
const talkPool = [ANIM.TALK, ANIM.SHRUG, ANIM.LAUGH];
const funPool = [ANIM.DANCE_SILLY];

////////////////////////////////////////////////////
// UTILS
////////////////////////////////////////////////////
const setStatus = (m) => {
  const e = document.getElementById("status");
  if (e) e.textContent = m;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

////////////////////////////////////////////////////
// SCENE & GLOBALS
////////////////////////////////////////////////////
let scene, camera, renderer, mixer, clock;
let baseModel, currentAction;
let clipsCache = {}, fbxCache = {};
let jawBone = null, fingerBones = [], focusBone = null;
let state = "boot", micLocked = false, sleepLock = false;
let cam = { radius: 5.8, yaw: 0, pitch: 1.3, drift: true, target: null };
let renderRAF = 0;

////////////////////////////////////////////////////
// INIT SCENE
////////////////////////////////////////////////////
function initThreeSafe() {
  if (typeof THREE === "undefined" || !THREE.FBXLoader) {
    console.error("ERROR: THREE or FBXLoader not found. Ensure they are loaded before bob.js");
    throw new Error("Missing THREE or FBXLoader");
  }

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, cam.radius);

  clock = new THREE.Clock();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(2, 4, 3);
  scene.add(dir);

  cam.target = new THREE.Vector3(0, 1.2, 0);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

////////////////////////////////////////////////////
// LOAD MODELS & TEXTURES
////////////////////////////////////////////////////
async function loadBaseModel() {
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[ANIM.IDLE_NEUTRAL]);
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
    if (o.isBone && /head|neck|spine2/i.test(o.name) && !focusBone) focusBone = o;
  });

  mixer = new THREE.AnimationMixer(baseModel);
}

async function loadClipsFor(name) {
  if (clipsCache[name]) return clipsCache[name];
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
  fbxCache[name] = fbx;
  const clones = (fbx.animations || []).map((c) => c.clone());
  clipsCache[name] = clones;
  return clones;
}

////////////////////////////////////////////////////
// ANIMATION CONTROL
////////////////////////////////////////////////////
async function playAnim(name, { fade = 0.4, loop = true, minHold = 0.6 } = {}) {
  if (!mixer) return;
  const clips = await loadClipsFor(name);
  if (!clips.length) return;
  const clip = clips[0];
  const next = mixer.clipAction(clip);
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  next.clampWhenFinished = !loop;
  next.enabled = true;

  if (currentAction) currentAction.crossFadeTo(next, fade, false);
  else next.fadeIn(fade);

  next.play();
  currentAction = next;

  if (minHold > 0) await sleep(minHold * 1000);
}

////////////////////////////////////////////////////
// CAMERA + RENDER
////////////////////////////////////////////////////
function updateCamera() {
  if (state === "idle" && cam.drift) {
    cam.yaw += Math.sin(performance.now() * 0.00015) * 0.002;
  }
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

function startRenderLoop() {
  cancelAnimationFrame(renderRAF);
  const tick = () => {
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);
    updateCamera();
    renderer.render(scene, camera);
    renderRAF = requestAnimationFrame(tick);
  };
  renderRAF = requestAnimationFrame(tick);
}

////////////////////////////////////////////////////
// AUDIO / TTS + JAW MOTION
////////////////////////////////////////////////////
function startAmplitudeDrive(audio) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const src = ctx.createMediaElementSource(audio);
    src.connect(analyser);
    analyser.connect(ctx.destination);

    const data = new Uint8Array(analyser.fftSize);
    function tick() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const amp = clamp(rms * 7, 0, 1);

      if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, -amp * 0.5, 0.35);
      for (const b of fingerBones) {
        if (b.rotation) b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, amp * 0.22, 0.25);
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  } catch (err) {
    console.warn("Amplitude drive error:", err);
  }
}

async function speakAndAnimate(text) {
  if (!text) return;
  state = "talking";
  setStatus("💬 Thinking...");
  await playAnim(pick(talkPool), { fade: 0.25, loop: true });
  try {
    const chat = await fetch(`${WORKER_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text })
    });
    const chatJson = await chat.json();
    const reply = chatJson.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:", reply);

    const tts = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply, voice: "onyx" })
    });
    if (!tts.ok) {
      console.warn("TTS error:", tts.status);
      state = "idle";
      await playAnim(ANIM.IDLE_NEUTRAL);
      return;
    }
    const buf = await tts.arrayBuffer();
    const blob = new Blob([buf], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = 0.92;
    audio.preservesPitch = false;

    audio.addEventListener("play", () => startAmplitudeDrive(audio), { once: true });
    await audio.play().catch((e) => console.warn("Audio play error:", e));

    audio.onended = async () => {
      state = "idle";
      setStatus("👂 Listening...");
      await playAnim(pick(idlePool));
    };
  } catch (err) {
    console.error("Speech error:", err);
    state = "idle";
    await playAnim(ANIM.IDLE_NEUTRAL);
  }
}

////////////////////////////////////////////////////
// IDLE / SLEEP LOGIC
////////////////////////////////////////////////////
async function fallAsleep() {
  if (state !== "idle" || sleepLock) return;
  sleepLock = true;
  state = "sleeping";
  setStatus("😴 Nodding off…");
  await playAnim(ANIM.LIE_DOWN, { fade: 0.45, loop: false });
  await playAnim(ANIM.SLEEP, { fade: 0.45, loop: true });
  cam.radius = 7.2;
}

async function wakeUp() {
  if (state !== "sleeping") return;
  setStatus("😮 Waking up…");
  cam.radius = 5.8;
  await playAnim(ANIM.WAKE, { fade: 0.45, loop: false });
  await playAnim(ANIM.IDLE_NEUTRAL, { fade: 0.45, loop: true });
  state = "idle";
  sleepLock = false;
  setStatus("👂 Listening...");
}

function scheduleIdle() {
  const next = 12000 + Math.random() * 12000;
  setTimeout(async () => {
    if (state !== "idle") {
      return scheduleIdle();
    }
    let name = pick(idlePool);
    if (Math.random() < 0.1) name = pick(funPool);
    await playAnim(name, { fade: 0.35 });
    if (Math.random() < 0.08 && !sleepLock) await fallAsleep();
    scheduleIdle();
  }, next);
}

////////////////////////////////////////////////////
// MICROPHONE SETUP
////////////////////////////////////////////////////
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition) {
  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";
  window.recognition = rec;

  rec.onresult = async (e) => {
    const t = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
    if (!t) return;
    if (state === "sleeping" && /hey\s*bob/.test(t)) {
      return wakeUp();
    }
    await speakAndAnimate(t);
  };
  rec.onerror = (e) => console.warn("Speech error:", e.error);
  rec.onend = () => {
    if (!micLocked && state !== "sleeping") rec.start();
  };
  window.addEventListener("click", () => {
    try {
      rec.start();
      setStatus("👂 Listening (mic on)...");
    } catch (err) {
      console.warn("Mic start error:", err);
    }
  }, { once: true });
}

////////////////////////////////////////////////////
// BOOT
////////////////////////////////////////////////////
async function boot() {
  console.log("🟢 Booting Bob (safe global) …");
  setStatus("Loading Bob …");
  initThreeSafe();
  await loadBaseModel();
  await Promise.all([
    loadClipsFor(ANIM.IDLE_NEUTRAL),
    loadClipsFor(ANIM.TALK),
    loadClipsFor(ANIM.WAKE)
  ]);
  await playAnim(ANIM.IDLE_NEUTRAL);
  startRenderLoop();
  scheduleIdle();
  state = "idle";
  setStatus("👂 Listening…");
  console.log("🎉 Bob ready!");
}

window.addEventListener("DOMContentLoaded", boot);
