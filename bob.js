/* Autonomous Bob v7.0 — no captions, no splash; jaw + voice + random behaviors */
console.log("🟢 Bob v7.0 init");

// ---------- CONFIG ----------
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE = "T-Pose.fbx"; // rig only; NOT played as an animation

// Include ALL animations you listed, EXCEPT T-Pose.
const ANIMS = {
  idle: [
    "Neutral Idle",
    "Breathing Idle",
    "Idle",
    "Bored",
    "Looking Around",
    "Shrugging",
    "Laughing",
    "Sad Idle",
    "Defeated"
  ],
  sleep: [
    "Sleeping Idle",
    "Sleeping Idle (1)",
    "Lying Down"
  ],
  movement: [
    "Walking",
    "Walkinglikezombie",
    "Walkingsneakily",
    "Stop Walking",
    "Waking"
  ],
  expressive: [
    "Talking",
    "Waving",
    "Shaking Head No",
    "Yelling Out",
    "Silly Dancing",
    "Laughing",
    "Looking Around"
  ],
  misc: [
    "Bored",
    "Defeated",
    "Sad Idle"
  ],
  all: [] // will be filled automatically (everything except T-Pose)
};

// Build master set
ANIMS.all = [
  ...new Set([
    ...ANIMS.idle,
    ...ANIMS.sleep,
    ...ANIMS.movement,
    ...ANIMS.expressive,
    ...ANIMS.misc
  ])
];

// Voice command keywords → animation categories or actions
const VOICE_MAP = [
  { kw: ["hey bob","hey, bob","bob"], action: "wake" },
  { kw: ["dance","boogie","move it"], action: "dance" },
  { kw: ["sleep","nap"], action: "sleep" },
  { kw: ["walk away","leave","go away"], action: "walkAway" },
  { kw: ["come back","return","back here"], action: "comeBack" },
  { kw: ["wave","hello"], action: "wave" },
  { kw: ["talk","speak","say something"], action: "talk" },
  { kw: ["yell","shout"], action: "yell" }
];

// Random cowboy quips. He speaks these aloud (no captions).
const QUIPS = {
  idle: [
    "Ain't much stirrin' out here.",
    "Wind's colder than a ghost's breath.",
    "Reckon I'll stretch these old bones.",
    "Just keepin' watch, partner.",
    "Time moves slower than molasses."
  ],
  dance: [
    "Y'all ain't ready for this two-step!",
    "Watch these bones boogie!",
    "I got rhythm for days.",
    "Dust off them boots!"
  ],
  sleep: [
    "Gonna catch me a quick shut-eye.",
    "Dreamin' of tumbleweeds and campfires.",
    "Wake me if the coyotes start singin'."
  ],
  walkAway: [
    "Hold yer horses, be right back!",
    "I'm moseyin' on for a spell.",
    "Don't go nowhere now!"
  ],
  return: [
    "Comin' on back, partner!",
    "Miss me?",
    "Well, I'll be—did ya call?"
  ],
  talk: [
    "Well now, partner, here's a tall tale.",
    "Listen up, this won't take long.",
    "Speak plain and I'll do the same."
  ],
  wave: [
    "Howdy there!",
    "Tip o’ the hat to ya!",
    "Good to see ya!"
  ],
  yell: [
    "Yeehaw!",
    "Whooo-eee!",
    "Heads up!"
  ]
};

// Idle timing
const IDLE_MIN_MS = 15000;
const IDLE_MAX_MS = 30000;

// Walk off distance/scale
const WALK_AWAY_Z = 8;     // positive moves away from camera
const WALK_SPEED  = 1.5;   // units per second
const SCALE_MIN   = 0.25;

// ---------- MINIMAL ERROR BADGE ----------
function showWarnBadge() {
  if (document.getElementById("bob-warn")) return;
  const b = document.createElement("div");
  b.id = "bob-warn";
  b.textContent = "⚠️";
  b.style.cssText = "position:fixed;top:10px;right:10px;font-size:24px;z-index:9999;user-select:none;";
  document.body.appendChild(b);
}

// ---------- THREE CORE ----------
let scene, camera, renderer, clock, mixer, model, currentAction, controls;
let jawBone = null;
let mouthMorphTargets = []; // if present
let isWalkingAway = false;
let isSleeping = false;
let lastAnimName = null;

const cache = {};
function rand(min, max) { return Math.random() * (max - min) + min; }
function choice(arr, avoid) {
  if (!arr.length) return null;
  const filtered = avoid ? arr.filter(a => a !== avoid) : arr;
  return filtered[Math.floor(Math.random() * filtered.length)] || arr[0];
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.45);
  const key  = new THREE.DirectionalLight(0xffffff, 0.55); key.position.set(2,4,3);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-2,2,-2);
  const rim  = new THREE.DirectionalLight(0xffffff, 0.30); rim.position.set(0,3,-3);
  scene.add(hemi, key, fill, rim);

  clock = new THREE.Clock();
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Optional OrbitControls for rehearsals — keep but don't show UI.
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0,1,0);
}

async function loadRig() {
  const loader = new FBXLoader();
  const url = FBX_BASE + encodeURIComponent(RIG_FILE);
  const fbx = await loader.loadAsync(url);
  fbx.scale.setScalar(1);
  fbx.position.set(0, 0, 0);
  fbx.traverse(o => {
    if (o.isMesh) {
      // Transparent enabled so we can fade on walk-away if we want.
      if (o.material) {
        o.material.transparent = true;
        o.material.opacity = 1.0;
        // Hook for your textures if needed:
        // applyUserMaterials(o);
      }
      // Gather morph targets if exist
      if (o.morphTargetDictionary) {
        for (const key in o.morphTargetDictionary) {
          if (/jaw|mouth|open/i.test(key)) mouthMorphTargets.push({ mesh: o, key, idx: o.morphTargetDictionary[key] });
        }
      }
    }
    if (o.isBone && /jaw/i.test(o.name)) jawBone = o;
    if (o.isBone && /mixamorigjaw/i.test(o.name.toLowerCase())) jawBone = o;
  });
  scene.add(fbx);
  model = fbx;
  mixer = new THREE.AnimationMixer(model);

  // Autoframe
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/1.5, size/2.5, size/1.5)));
  camera.lookAt(center);
  controls.target.copy(center);

  return model;
}

function applyUserMaterials(o /* Mesh */) {
  // Optional: set your realistic textures here if you want to override materials
  // Example:
  // const tex = textureCache["BobSkin"] || (textureCache["BobSkin"] = new THREE.TextureLoader().load(FBX_BASE + "YourTexture.png"));
  // tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
  // o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
}

// ---------- ANIMATION LOAD/PLAY ----------
async function loadClip(name) {
  if (cache[name]) return cache[name];
  const loader = new FBXLoader();
  const url = FBX_BASE + encodeURIComponent(name) + ".fbx";
  const fbx = await loader.loadAsync(url);
  const clip = fbx.animations[0];
  cache[name] = clip;
  return clip;
}

async function play(name, loop = THREE.LoopRepeat, fade = 0.35) {
  if (!mixer) return;
  const clip = await loadClip(name);
  if (!clip) return;
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop, Infinity);
  if (currentAction && currentAction !== action) currentAction.crossFadeTo(action, fade, false);
  action.play();
  currentAction = action;
  lastAnimName = name;
}

// ---------- BRAIN (RANDOM BEHAVIOR) ----------
let idleTimer = null;
function scheduleIdleCycle() {
  clearTimeout(idleTimer);
  const delay = rand(IDLE_MIN_MS, IDLE_MAX_MS);
  idleTimer = setTimeout(async () => {
    if (isSleeping || isWalkingAway) { scheduleIdleCycle(); return; }
    // 10% chance to nap
    const doNap = Math.random() < 0.10;
    // 15% chance to wander
    const doWalk = Math.random() < 0.15;
    // 15% chance to dance
    const doDance = Math.random() < 0.15;

    if (doNap) { await goSleepRandom(); }
    else if (doWalk) { await walkAwayAndReturn(); }
    else if (doDance) { await doDanceRandom(); }
    else { await randomIdle(); }

    scheduleIdleCycle();
  }, delay);
}

async function randomIdle() {
  const name = choice(ANIMS.idle, lastAnimName);
  await play(name);
  maybeSay(QUIPS.idle);
}

async function goSleepRandom() {
  isSleeping = true;
  const name = choice(ANIMS.sleep, lastAnimName);
  await play(name);
  maybeSay(QUIPS.sleep);
}

async function wakeUpRandom() {
  if (!isSleeping) return;
  isSleeping = false;
  const wake = choice(["Waking", "Yelling Out", "Talking"]);
  await play(wake, THREE.LoopOnce);
  setTimeout(() => play("Neutral Idle"), 1200);
  maybeSay(QUIPS.return);
}

async function doDanceRandom() {
  const name = choice(["Silly Dancing", "Walkingsneakily", "Laughing"], lastAnimName);
  await play(name);
  maybeSay(QUIPS.dance);
}

async function waveHello() {
  await play("Waving", THREE.LoopOnce);
}

async function talkBit() {
  await play("Talking");
  maybeSay(QUIPS.talk);
}

async function yellBit() {
  await play("Yelling Out", THREE.LoopOnce);
  maybeSay(QUIPS.yell);
}

async function walkAwayAndReturn() {
  // Walk away
  isWalkingAway = true;
  await play(choice(["Walking", "Walkingsneakily"], lastAnimName));
  maybeSay(QUIPS.walkAway);

  // Move away & scale down over time
  const start = performance.now();
  const startZ = model.position.z;
  const startScale = model.scale.x;
  const targetZ = WALK_AWAY_Z;
  const targetScale = SCALE_MIN;
  const dur = Math.abs((targetZ - startZ) / WALK_SPEED) * 1000;

  await new Promise(res => {
    function step(t) {
      const k = Math.min(1, (t - start) / dur);
      // Lerp position z and scale
      model.position.z = startZ + (targetZ - startZ) * k;
      const s = startScale + (targetScale - startScale) * k;
      model.scale.setScalar(s);
      // Fade slightly
      setModelOpacity(1 - 0.7 * k);
      if (k < 1) requestAnimationFrame(step); else res();
    }
    requestAnimationFrame(step);
  });

  // Wait a breath
  await new Promise(r => setTimeout(r, 900));

  // Return
  maybeSay(QUIPS.return);
  await play(choice(["Walking", "Walkinglikezombie"], lastAnimName));

  const backStart = performance.now();
  const backDur = dur;
  await new Promise(res => {
    function step(t) {
      const k = Math.min(1, (t - backStart) / backDur);
      model.position.z = targetZ + (0 - targetZ) * k;
      const s = targetScale + (1 - targetScale) * k;
      model.scale.setScalar(s);
      setModelOpacity(0.3 + 0.7 * k);
      if (k < 1) requestAnimationFrame(step); else res();
    }
    requestAnimationFrame(step);
  });

  isWalkingAway = false;
  await play("Neutral Idle");
}

function setModelOpacity(alpha) {
  model.traverse(o => {
    if (o.isMesh && o.material) {
      if (Array.isArray(o.material)) {
        o.material.forEach(m => { m.transparent = true; m.opacity = alpha; });
      } else {
        o.material.transparent = true; o.material.opacity = alpha;
      }
    }
  });
}

// ---------- VOICE (LISTEN + SPEAK) ----------
let recognition = null;
let speaking = false;
let jawPhase = 0;

function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return; // no badge; just silent if unavailable
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (e) => {
    const idx = e.resultIndex;
    const transcript = (e.results[idx] && e.results[idx][0] && e.results[idx][0].transcript || "").toLowerCase();
    handleCommand(transcript);
  };
  recognition.onerror = () => {}; // silent
  recognition.onend = () => { try { recognition.start(); } catch {} }; // keep alive
  try { recognition.start(); } catch {}
}

function handleCommand(txt) {
  // Wake phrase
  if (/hey\s*bob/.test(txt)) { wakeUpRandom(); return; }

  // Match registered actions
  for (const m of VOICE_MAP) {
    if (m.kw.some(k => txt.includes(k))) {
      switch (m.action) {
        case "wake": wakeUpRandom(); break;
        case "dance": doDanceRandom(); break;
        case "sleep": goSleepRandom(); break;
        case "walkAway": walkAwayAndReturn(); break;
        case "comeBack": wakeUpRandom(); break;
        case "wave": waveHello(); break;
        case "talk": talkBit(); break;
        case "yell": yellBit(); break;
      }
      return;
    }
  }

  // Unknown → shrug or small idle switch
  play(choice(["Shrugging","Looking Around","Shaking Head No"], lastAnimName));
}

function sayRandom(arr) {
  if (!window.speechSynthesis || !arr || !arr.length) return;
  const phrase = choice(arr);
  if (!phrase) return;
  const u = new SpeechSynthesisUtterance(phrase);
  u.rate = 0.95; u.pitch = 0.9; u.volume = 1.0;
  u.onstart = () => { speaking = true; };
  u.onend = () => { speaking = false; closeMouth(); };
  speechSynthesis.speak(u);
}

function maybeSay(arr) {
  if (Math.random() < 0.55) sayRandom(arr);
}

function closeMouth() {
  if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, 0, 0.7);
  mouthMorphTargets.forEach(({mesh, idx}) => { mesh.morphTargetInfluences[idx] = 0; });
}

// Simple mouth-flap while speaking: oscillate jaw/morphs
function updateJaw(dt) {
  if (!speaking) return;
  jawPhase += dt * 6 + Math.random() * 0.5;
  const open = 0.08 + 0.06 * Math.abs(Math.sin(jawPhase));
  if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, open, 0.5);
  mouthMorphTargets.forEach(({mesh, idx}) => {
    mesh.morphTargetInfluences[idx] = THREE.MathUtils.lerp(mesh.morphTargetInfluences[idx] || 0, open * 6, 0.5);
  });
}

// ---------- CAMERA DRIFT ----------
function updateCamera(dt) {
  // Gentle orbit drift unless walking/sleeping
  if (!isWalkingAway && !isSleeping) {
    const drift = 0.1 * dt;
    controls.target.y = THREE.MathUtils.lerp(controls.target.y, 1.1 + Math.sin(performance.now()*0.0003)*0.05, 0.15);
    camera.position.x += Math.sin(performance.now()*0.0002) * drift;
    camera.position.z += Math.cos(performance.now()*0.0002) * drift;
  }
  controls.update();
}

// ---------- MAIN LOOP ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  updateJaw(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ---------- BOOT ----------
(async () => {
  try {
    if (typeof window.FBXLoader === "undefined" && window.THREE && THREE.FBXLoader) {
      window.FBXLoader = THREE.FBXLoader;
    }
    if (typeof THREE === "undefined" || typeof FBXLoader === "undefined") throw new Error("THREE/FBXLoader missing");

    initThree();
    await loadRig();
    await play("Neutral Idle");
    scheduleIdleCycle();
    initSpeech();
    animate();
  } catch (e) {
    console.error(e);
    showWarnBadge(); // Only subtle ⚠️ if something goes wrong
  }
})();
