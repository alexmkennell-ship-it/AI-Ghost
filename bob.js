// bob.js — v5.2 "Global Loader Edition (Legacy)"
// ✅ Works with r146 global three.js + FBXLoader
// ✅ FBX animation, voice, idle skits, and smooth camera
console.log("🟢 Booting Bob (global legacy)…");

/////////////////////////////////////////////////////
// CONFIG
/////////////////////////////////////////////////////
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/";
const TEX_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

/////////////////////////////////////////////////////
// VERIFY GLOBALS
/////////////////////////////////////////////////////
if (typeof THREE === "undefined" || typeof THREE.FBXLoader === "undefined") {
  console.error("❌ THREE.js or FBXLoader not loaded globally. Check script order in HTML.");
  throw new Error("Missing THREE or FBXLoader");
}

const FBXLoader = hasFBXOnThree
  ? globalScope.THREE.FBXLoader
  : globalScope.FBXLoader;

if (!hasFBXOnThree && hasGlobalFBX) {
  globalScope.THREE.FBXLoader = FBXLoader;
}

console.log("✅ THREE.js + FBXLoader detected.");

const FBXLoader = THREE.FBXLoader;

/////////////////////////////////////////////////////
// UTILITIES
/////////////////////////////////////////////////////
const setStatus = (m) => (document.getElementById("status").textContent = m);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/////////////////////////////////////////////////////
// GLOBALS
/////////////////////////////////////////////////////
let scene, camera, renderer, clock, mixer;
let model, currentAction = null;
let jawBone = null, fingerBones = [], focusBone = null;
let state = "boot", micLocked = false;
let cam = { radius: 5.8, yaw: 0, pitch: 1.308996939, drift: true, target: null };

/////////////////////////////////////////////////////
// FILE MAP
/////////////////////////////////////////////////////
const FILES = {
  "Neutral Idle": "Neutral Idle.fbx",
  "Breathing Idle": "Breathing Idle.fbx",
  "Looking Around": "Looking Around.fbx",
  "Talking": "Talking.fbx",
  "Sleeping Idle": "Sleeping Idle.fbx",
  "Waking": "Waking.fbx",
  "Bored": "Bored.fbx",
  "Silly Dancing": "Silly Dancing.fbx",
};

/////////////////////////////////////////////////////
// INIT
/////////////////////////////////////////////////////
function initThree() {
  if (!cam.target) {
    cam.target = new THREE.Vector3(0, 1.2, 0);
  }
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, cam.radius);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(2, 4, 3);
  scene.add(hemi);
  scene.add(key);

  clock = new THREE.Clock();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/////////////////////////////////////////////////////
// MODEL LOADING
/////////////////////////////////////////////////////
async function loadModel() {
  const loader = new FBXLoaderCtor();
  const fbx = await loader.loadAsync(FBX_BASE + FILES["Neutral Idle"]);
  fbx.scale.setScalar(0.01);
  scene.add(fbx);
  model = fbx;

  const tex = await new THREE.TextureLoader().loadAsync(TEX_URL);
  tex.flipY = false;
  model.traverse((o) => {
    if (o.isMesh) {
      o.material.map = tex;
      o.material.needsUpdate = true;
    }
    if (o.isBone && /jaw|chin/i.test(o.name)) jawBone = o;
    if (o.isBone && /(finger|thumb|hand|wrist)/i.test(o.name)) fingerBones.push(o);
    if (o.isBone && /head|neck|spine2/i.test(o.name) && !focusBone) focusBone = o;
  });

  mixer = new THREE.AnimationMixer(model);
}

/////////////////////////////////////////////////////
// ANIMATION
/////////////////////////////////////////////////////
const cache = {};
async function loadClip(name) {
  if (cache[name]) return cache[name];
  const loader = new FBXLoaderCtor();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
  const clip = fbx.animations[0];
  cache[name] = clip;
  return clip;
}

async function play(name, fade = 0.4, loop = true) {
  if (!mixer) {
    console.warn(`Mixer unavailable; skipping animation "${name}".`);
    return;
  }
  const clip = await loadClip(name);
  if (!clip) return;
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  if (currentAction) currentAction.crossFadeTo(action, fade, false);
  else action.fadeIn(fade);
  action.play();
  currentAction = action;
}

/////////////////////////////////////////////////////
// CAMERA + LOOP
/////////////////////////////////////////////////////
function updateCamera() {
  if (state === "idle" && cam.drift)
    cam.yaw += Math.sin(performance.now() * 0.00015) * 0.002;
  const r = cam.radius,
    y = cam.pitch,
    xz = r * Math.cos(y);
  camera.position.set(
    cam.target.x + xz * Math.sin(cam.yaw),
    cam.target.y + r * Math.sin(y),
    cam.target.z + xz * Math.cos(cam.yaw)
  );
  camera.lookAt(cam.target);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  updateCamera();
  renderer.render(scene, camera);
}

/////////////////////////////////////////////////////
// SPEECH
/////////////////////////////////////////////////////
async function speakAndAnimate(text) {
  if (!text) return;
  state = "talking";
  await play("Talking", 0.25, true);

  const resp = await fetch(`${WORKER_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: text }),
  });
  const data = await resp.json();
  const reply = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
  const tts = await fetch(`${WORKER_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: reply, voice: "onyx" }),
  });
  const buf = await tts.arrayBuffer();
  const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
  audio.onended = async () => {
    state = "idle";
    await play("Neutral Idle");
  };
  await audio.play();
}

/////////////////////////////////////////////////////
// SKITS + IDLE
/////////////////////////////////////////////////////
const SKITS = [
  "Ain’t much goin’ on… just me and my thoughts rattlin’.",
  "Keepin’ an eye socket out for trouble.",
  "They call this one the Rattle-‘n-Roll!",
  "Whoo-wee… dreamt I was a scarecrow with a 401K.",
];

async function randomIdle() {
  while (true) {
    if (state === "idle" && Math.random() < 0.4) {
      const anim = pick(["Breathing Idle", "Looking Around", "Bored", "Silly Dancing"]);
      await play(anim);
      if (Math.random() < 0.3) {
        const line = pick(SKITS);
        const tts = await fetch(`${WORKER_URL}/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: line, voice: "onyx" }),
        });
        const buf = await tts.arrayBuffer();
        const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" })));
        await audio.play();
      }
    }
    await sleepMs(15000 + Math.random() * 10000);
  }
}

/////////////////////////////////////////////////////
// BOOT
/////////////////////////////////////////////////////
async function boot() {
  setStatus("Initializing Bob...");
  await ensureThreeAndFBXLoader();
  initThree();
  await loadModel();
  await play("Neutral Idle");
  animate();
  state = "idle";
  setStatus("👂 Listening...");
  randomIdle();
}
boot().catch((err) => {
  console.error(err);
  setStatus("❌ Failed to load Bob. Check console for details.");
});
