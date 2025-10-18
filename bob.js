// bob.js — v5.3 "Global Loader Edition (Legacy)"
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
const globalScope = typeof window !== "undefined" ? window : globalThis;
let FBXLoaderCtor = null;
let usingFallback = false;
const fallbackClips = {};
const fallbackState = { root: null, ground: null, mixer: null };

const CAM_DEFAULT = Object.freeze({
  radius: 5.8,
  yaw: 0,
  pitch: 1.308996939,
  drift: true,
  target: null,
});

async function ensureThreeAndFBXLoader() {
  const start = (globalScope.performance?.now?.() ?? Date.now());
  const timeoutMs = 5000;
  while (true) {
    const hasThree = typeof globalScope.THREE !== "undefined";
    const loaderCandidate = hasThree && typeof globalScope.THREE.FBXLoader === "function"
      ? globalScope.THREE.FBXLoader
      : typeof globalScope.FBXLoader === "function"
        ? globalScope.FBXLoader
        : null;

    if (hasThree && loaderCandidate) {
      if (!globalScope.THREE.FBXLoader) {
        globalScope.THREE.FBXLoader = loaderCandidate;
      }
      FBXLoaderCtor = loaderCandidate;
      console.log("✅ THREE.js + FBXLoader detected.");
      return true;
    }

    const elapsed = (globalScope.performance?.now?.() ?? Date.now()) - start;
    if (elapsed > timeoutMs) {
      console.error("❌ THREE.js or FBXLoader not loaded globally. Check script order in HTML.");
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

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
let cam = { ...CAM_DEFAULT };

function applyCameraDefaults() {
  cam.radius = CAM_DEFAULT.radius;
  cam.yaw = CAM_DEFAULT.yaw;
  cam.pitch = CAM_DEFAULT.pitch;
  cam.drift = CAM_DEFAULT.drift;
  if (typeof THREE !== "undefined" && THREE.Vector3) {
    if (!cam.target) {
      cam.target = new THREE.Vector3(0, 1.2, 0);
    } else {
      cam.target.set(0, 1.2, 0);
    }
  }
}

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
  applyCameraDefaults();
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
  if (!FBXLoaderCtor) {
    throw new Error("FBXLoader constructor unavailable. ensureThreeAndFBXLoader() must run first.");
  }
  const loader = new FBXLoaderCtor();
  let fbx;
  try {
    fbx = await loader.loadAsync(FBX_BASE + FILES["Neutral Idle"]);
  } catch (err) {
    const wrapped = new Error(`Failed to load Neutral Idle FBX: ${err?.message ?? err}`);
    wrapped.cause = err;
    throw wrapped;
  }
  fbx.scale.setScalar(0.01);
  scene.add(fbx);
  model = fbx;

  let tex = null;
  try {
    tex = await new THREE.TextureLoader().loadAsync(TEX_URL);
    tex.flipY = false;
  } catch (texErr) {
    console.warn("⚠️ Failed to load Bob texture, continuing without it:", texErr);
  }
  model.traverse((o) => {
    if (o.isMesh) {
      if (tex) {
        o.material.map = tex;
      } else {
        o.material.color = new THREE.Color(0xfff2d4);
      }
      o.material.needsUpdate = true;
    }
    if (o.isBone && /jaw|chin/i.test(o.name)) jawBone = o;
    if (o.isBone && /(finger|thumb|hand|wrist)/i.test(o.name)) fingerBones.push(o);
    if (o.isBone && /head|neck|spine2/i.test(o.name) && !focusBone) focusBone = o;
  });

  mixer = new THREE.AnimationMixer(model);
  return model.animations?.[0] ?? null;
}

function ensureFallbackClips() {
  if (Object.keys(fallbackClips).length) {
    return;
  }

  const idleYawTrack = new THREE.NumberKeyframeTrack(".rotation[y]", [0, 2.5, 5], [-0.12, 0.12, -0.12]);
  const idleBobTrack = new THREE.NumberKeyframeTrack(".position[y]", [0, 2.5, 5], [0, 0.07, 0]);
  fallbackClips["Neutral Idle"] = new THREE.AnimationClip("Neutral Idle", 5, [idleYawTrack, idleBobTrack]);

  const breatheScale = new THREE.NumberKeyframeTrack(".scale[y]", [0, 1.2, 2.4], [1, 1.05, 1]);
  fallbackClips["Breathing Idle"] = new THREE.AnimationClip("Breathing Idle", 2.4, [breatheScale]);

  const lookAroundYaw = new THREE.NumberKeyframeTrack(".rotation[y]", [0, 1, 2, 3], [-0.35, 0.25, 0.35, -0.35]);
  const lookAroundPitch = new THREE.NumberKeyframeTrack(".rotation[x]", [0, 1.5, 3], [0.03, -0.04, 0.03]);
  fallbackClips["Looking Around"] = new THREE.AnimationClip("Looking Around", 3, [lookAroundYaw, lookAroundPitch]);

  const talkingTrack = new THREE.NumberKeyframeTrack(".rotation[x]", [0, 0.2, 0.4, 0.6], [0, -0.08, 0.08, 0]);
  fallbackClips["Talking"] = new THREE.AnimationClip("Talking", 0.6, [talkingTrack]);

  const sleepingTrack = new THREE.NumberKeyframeTrack(".rotation[x]", [0, 1.5, 3], [0, 0.5, 0]);
  fallbackClips["Sleeping Idle"] = new THREE.AnimationClip("Sleeping Idle", 3, [sleepingTrack]);

  const wakingTrack = new THREE.NumberKeyframeTrack(".rotation[x]", [0, 0.4, 0.8], [0.5, 0.1, 0]);
  fallbackClips["Waking"] = new THREE.AnimationClip("Waking", 0.8, [wakingTrack]);

  const boredTrack = new THREE.NumberKeyframeTrack(".position[y]", [0, 1.5, 3], [0, -0.08, 0]);
  fallbackClips["Bored"] = new THREE.AnimationClip("Bored", 3, [boredTrack]);

  const sillyYaw = new THREE.NumberKeyframeTrack(".rotation[y]", [0, 0.4, 0.8, 1.2, 1.6], [0, 0.6, -0.6, 0.6, 0]);
  const sillyPos = new THREE.NumberKeyframeTrack(".position[x]", [0, 0.4, 0.8, 1.2, 1.6], [0, 0.4, -0.4, 0.4, 0]);
  fallbackClips["Silly Dancing"] = new THREE.AnimationClip("Silly Dancing", 1.6, [sillyYaw, sillyPos]);
}

function createFallbackModel(reason, options = {}) {
  const { placeholder = false } = options;
  if (reason) {
    console.warn("⚠️ Falling back to procedural Bob due to:", reason);
  }

  if (!fallbackState.root) {
    const cowboy = new THREE.Group();
    cowboy.position.set(0, 0.9, 0);

    const boneMaterial = new THREE.MeshStandardMaterial({ color: 0xfff2d4, roughness: 0.45, metalness: 0.05 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x87512a, roughness: 0.6, metalness: 0.1 });

    const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), new THREE.MeshStandardMaterial({ color: 0x1a1209, roughness: 0.9, metalness: 0.05 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.4;
    scene.add(ground);

    const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.2, 4, 16), boneMaterial);
    spine.position.y = 0.5;
    cowboy.add(spine);

    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.4, 4, 12), boneMaterial);
    pelvis.position.y = -0.1;
    cowboy.add(pelvis);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 20), boneMaterial);
    head.position.y = 1.2;
    cowboy.add(head);

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.2), boneMaterial);
    jaw.position.set(0, 1.0, 0.08);
    cowboy.add(jaw);

    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24), accentMaterial);
    hatBrim.position.y = 1.37;
    cowboy.add(hatBrim);

    const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.28, 24), accentMaterial);
    hatTop.position.y = 1.5;
    cowboy.add(hatTop);

    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.7, 4, 12), boneMaterial);
    leftArm.position.set(-0.45, 0.55, 0);
    leftArm.rotation.z = Math.PI / 4;
    cowboy.add(leftArm);

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.45;
    rightArm.rotation.z = -Math.PI / 4;
    cowboy.add(rightArm);

    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.9, 4, 12), boneMaterial);
    leftLeg.position.set(-0.18, -0.85, 0);
    cowboy.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.18;
    cowboy.add(rightLeg);

    const spur = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 12, 24), accentMaterial);
    spur.rotation.x = Math.PI / 2;
    spur.position.set(-0.18, -1.3, -0.12);
    cowboy.add(spur);
    const spur2 = spur.clone();
    spur2.position.x = 0.18;
    cowboy.add(spur2);

    scene.add(cowboy);
    fallbackState.root = cowboy;
    fallbackState.ground = ground;
  } else {
    if (scene.children.indexOf(fallbackState.root) === -1) {
      scene.add(fallbackState.root);
    }
    if (fallbackState.ground && scene.children.indexOf(fallbackState.ground) === -1) {
      scene.add(fallbackState.ground);
    }
  }

  ensureFallbackClips();
  usingFallback = true;
  jawBone = null;
  fingerBones = [];
  focusBone = null;
  model = fallbackState.root;
  if (!fallbackState.mixer) {
    fallbackState.mixer = new THREE.AnimationMixer(model);
  }
  mixer = fallbackState.mixer;
  currentAction = null;

  cam.target = new THREE.Vector3(0, 1.05, 0);
  cam.radius = placeholder ? 4.9 : 4.4;
  cam.pitch = 0.65;
  cam.drift = false;

  if (fallbackState.ground) {
    fallbackState.ground.visible = true;
  }

  if (placeholder) {
    setStatus("⏳ Loading Bob assets… showing fallback cowboy.");
  } else {
    setStatus("⚠️ Loaded fallback Bob. Animations simplified while original assets are unavailable.");
  }

  return model;
}

function disposeFallbackModel() {
  const root = fallbackState.root;
  const ground = fallbackState.ground;
  const fallbackMixer = fallbackState.mixer;

  if (!root && !ground) {
    usingFallback = false;
    return;
  }

  if (ground) {
    scene.remove(ground);
    if (ground.geometry) ground.geometry.dispose?.();
    if (ground.material) {
      const mats = Array.isArray(ground.material) ? ground.material : [ground.material];
      mats.forEach((m) => m.dispose?.());
    }
  }

  if (root) {
    scene.remove(root);
    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose?.());
      }
    });
  }

  fallbackState.root = null;
  fallbackState.ground = null;
  fallbackState.mixer = null;
  Object.keys(fallbackClips).forEach((k) => delete fallbackClips[k]);

  if (mixer === fallbackMixer) {
    mixer.stopAllAction?.();
    mixer = null;
  }
  if (currentAction) {
    currentAction.stop();
    currentAction = null;
  }
  if (model === root) {
    model = null;
  }
  usingFallback = false;
  applyCameraDefaults();
}

/////////////////////////////////////////////////////
// ANIMATION
/////////////////////////////////////////////////////
const cache = {};
async function loadClip(name) {
  if (usingFallback) {
    return fallbackClips[name] ?? fallbackClips["Neutral Idle"] ?? null;
  }
  if (cache[name]) return cache[name];
  if (!FBXLoaderCtor) {
    throw new Error("FBXLoader constructor unavailable. ensureThreeAndFBXLoader() must run first.");
  }
  const loader = new FBXLoaderCtor();
  let fbx;
  try {
    fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
  } catch (err) {
    const wrapped = new Error(`Failed to load FBX clip "${name}": ${err?.message ?? err}`);
    wrapped.cause = err;
    throw wrapped;
  }
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
  const loaderAvailable = await ensureThreeAndFBXLoader();
  initThree();
  animate();

  let neutralClip = null;

  if (!loaderAvailable) {
    if (typeof globalScope.THREE === "undefined") {
      throw new Error("THREE.js failed to load; cannot render Bob or fallback geometry.");
    }
    createFallbackModel(new Error("Missing THREE or FBXLoader"));
  } else {
    createFallbackModel(undefined, { placeholder: true });
    await play("Neutral Idle");
    try {
      neutralClip = await loadModel();
      disposeFallbackModel();
    } catch (err) {
      console.error(err);
      createFallbackModel(err);
    }
  }

  if (!model) {
    throw new Error("Failed to initialize Bob model.");
  }

  if (neutralClip) {
    cache["Neutral Idle"] = neutralClip;
  }

  await play("Neutral Idle");
  state = "idle";
  if (usingFallback) {
    setStatus("⚠️ Using fallback Bob. 👂 Listening...");
  } else {
    setStatus("👂 Listening...");
  }
  randomIdle();
}
boot().catch((err) => {
  console.error(err);
  const msg = err?.message ? `❌ ${err.message}` : "❌ Failed to load Bob. Check console for details.";
  setStatus(msg);
});
