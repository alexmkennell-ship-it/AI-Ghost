// bob.js — v5.4 "Global Legacy Edition"
// ✅ Works with r146 global three.js + FBXLoader
// ✅ FBX animation, idle skits, and voice support
console.log("🟢 Booting Bob (v5.4 Global Legacy)…");

/////////////////////////////////////////////////////
// CONFIG
/////////////////////////////////////////////////////
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/models/";;
const TEX_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

// Fix GitHub Pages loader timing
if (typeof FBXLoader === "undefined" && typeof THREE !== "undefined" && THREE.FBXLoader) {
  window.FBXLoader = THREE.FBXLoader;
  console.log("🧩 FBXLoader patched to global scope from THREE namespace.");
}

/////////////////////////////////////////////////////
// VERIFY GLOBALS
/////////////////////////////////////////////////////
if (typeof THREE === "undefined" || typeof FBXLoader === "undefined") {
  console.error("❌ THREE.js or FBXLoader not loaded globally. Check script order in HTML.");
  throw new Error("Missing THREE or FBXLoader");
}
console.log("✅ THREE.js + FBXLoader detected.");

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
let state = "boot";
let usingFallback = false;
const fallbackClips = {};
const fallbackState = {};
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
  if (!cam.target) cam.target = new THREE.Vector3(0, 1.2, 0);

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
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES["Neutral Idle"]);
  fbx.scale.setScalar(0.01);
  scene.add(fbx);
  model = fbx;

  try {
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
  } catch (err) {
    console.warn("⚠️ Failed to load texture, continuing with flat color:", err);
  }

  mixer = new THREE.AnimationMixer(model);
  return model.animations?.[0] ?? null;
}

/////////////////////////////////////////////////////
// FALLBACK MODEL
/////////////////////////////////////////////////////
function createFallbackModel(reason) {
  usingFallback = true;
  if (reason) console.warn("⚠️ Falling back to procedural Bob due to:", reason);

  jawBone = null;
  fingerBones = [];
  focusBone = null;

  const cowboy = new THREE.Group();
  cowboy.position.set(0, 0.9, 0);

  const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xfff2d4, roughness: 0.45, metalness: 0.05 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x87512a, roughness: 0.6, metalness: 0.1 });

  const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), new THREE.MeshStandardMaterial({ color: 0x1a1209 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.4;
  scene.add(ground);

  const parts = [
    new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.2, 4, 16), boneMaterial), // spine
    new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.4, 4, 12), boneMaterial), // pelvis
    new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 20), boneMaterial), // head
    new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.2), boneMaterial), // jaw
  ];
  parts[0].position.y = 0.5;
  parts[1].position.y = -0.1;
  parts[2].position.y = 1.2;
  parts[3].position.set(0, 1.0, 0.08);
  parts.forEach(p => cowboy.add(p));

  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24), accentMaterial);
  hatBrim.position.y = 1.37;
  cowboy.add(hatBrim);
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.28, 24), accentMaterial);
  hatTop.position.y = 1.5;
  cowboy.add(hatTop);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.7, 4, 12), boneMaterial);
  leftArm.position.set(-0.45, 0.55, 0);
  leftArm.rotation.z = Math.PI / 4;
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.45;
  rightArm.rotation.z = -Math.PI / 4;
  cowboy.add(leftArm, rightArm);

  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.9, 4, 12), boneMaterial);
  leftLeg.position.set(-0.18, -0.85, 0);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.18;
  cowboy.add(leftLeg, rightLeg);

  const spur = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 12, 24), accentMaterial);
  spur.rotation.x = Math.PI / 2;
  spur.position.set(-0.18, -1.3, -0.12);
  const spur2 = spur.clone();
  spur2.position.x = 0.18;
  cowboy.add(spur, spur2);

  scene.add(cowboy);
  model = cowboy;
  mixer = new THREE.AnimationMixer(model);

  const idleYawTrack = new THREE.NumberKeyframeTrack(".rotation[y]", [0, 2.5, 5], [-0.12, 0.12, -0.12]);
  const idleBobTrack = new THREE.NumberKeyframeTrack(".position[y]", [0, 2.5, 5], [0, 0.07, 0]);
  fallbackClips["Neutral Idle"] = new THREE.AnimationClip("Neutral Idle", 5, [idleYawTrack, idleBobTrack]);

  cam.target = new THREE.Vector3(0, 1.1, 0);
  setStatus("⚠️ Loaded fallback Bob (simplified animations).");
}

/////////////////////////////////////////////////////
// ANIMATION
/////////////////////////////////////////////////////
const cache = {};
async function loadClip(name) {
  if (usingFallback) return fallbackClips[name] ?? fallbackClips["Neutral Idle"] ?? null;
  if (cache[name]) return cache[name];
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
  const clip = fbx.animations[0];
  cache[name] = clip;
  return clip;
}

async function play(name, fade = 0.4, loop = true) {
  if (!mixer) return;
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
// SPEECH + SKITS
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
  initThree();

  try {
    await loadModel();
  } catch (err) {
    console.error(err);
    createFallbackModel(err);
  }

  if (!model) createFallbackModel(new Error("Model failed to load."));

  await play("Neutral Idle");
  animate();

  state = "idle";
  setStatus(usingFallback ? "⚠️ Using fallback Bob. 👂 Listening..." : "👂 Listening...");
  randomIdle();
}

boot().catch((err) => {
  console.error(err);
  setStatus("❌ Failed to load Bob. Check console for details.");
});
