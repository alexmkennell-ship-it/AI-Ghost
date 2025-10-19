import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";


const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const TEXTURE_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

// Keep Bob's animation catalogue in sync with the authoritative list used by
// the worker deployment.  We dedupe here because the worker snippet repeats
// "Waking" and we only need to load each clip once.
const RAW_ANIMATION_LIST = [
  "Neutral Idle",
  "Breathing Idle",
  "Idle",
  "Bored",
  "Looking Around",
  "Lying Down",
  "Sleeping Idle",
  "Sleeping Idle (1)",
  "Waking",
  "Silly Dancing",
  "Walkingsneakily",
  "Walking",
  "Walkinglikezombie",
  "Stop Walking",
  "Waving",
  "Shaking Head No",
  "Shrugging",
  "Talking",
  "Laughing",
  "Defeated",
  "Sad Idle",
  "Yelling Out",
];

export const BOB_ANIMATIONS = Object.freeze([...new Set(RAW_ANIMATION_LIST)]);
export const ANIMS = BOB_ANIMATIONS;

// Bob's expanded skit library pairs each featured animation (or sequence of
// animations) with voice lines voiced by Onyx.  Consumers can iterate over this
// structure to surface curated combos in UIs or trigger them programmatically.
export const BOB_SKITS = Object.freeze([
  Object.freeze({
    category: "Idle / Chatter",
    skits: Object.freeze([
      Object.freeze({
        animations: Object.freeze(["Neutral Idle"]),
        lines: Object.freeze([
          "Just me and the tumbleweeds again.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Looking Around"]),
        lines: Object.freeze([
          "You ever get that feelin' someone's watchin' ya? … Nah.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Bored"]),
        lines: Object.freeze([
          "If bones could snore, I'd be rattlin' the rafters right now.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Breathing Idle"]),
        lines: Object.freeze([
          "Ahhh, nice night to be undead.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Sad Idle"]),
        lines: Object.freeze([
          "Used to dance every Saturday night… now I just creak.",
        ]),
      }),
    ]),
  }),
  Object.freeze({
    category: "Greeting / Social",
    skits: Object.freeze([
      Object.freeze({
        animations: Object.freeze(["Waving"]),
        lines: Object.freeze([
          "Howdy, stranger! You're lookin' more alive than me!",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Laughing"]),
        lines: Object.freeze([
          "Heh, that joke really tickled my funny bone!",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Shrugging"]),
        lines: Object.freeze([
          "Beats me! I just work here in the afterlife.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Shaking Head No"]),
        lines: Object.freeze([
          "Nope. Not today. Not even for all the gold in the desert.",
        ]),
      }),
    ]),
  }),
  Object.freeze({
    category: "Sleep / Wake",
    skits: Object.freeze([
      Object.freeze({
        animations: Object.freeze(["Lying Down", "Sleeping Idle"]),
        lines: Object.freeze([
          "Don't mind me, just restin' my femurs.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Waking"]),
        lines: Object.freeze([
          "Whoo-wee, dreamt I was dancin' with a banshee again.",
        ]),
      }),
    ]),
  }),
  Object.freeze({
    category: "Fun / Random",
    skits: Object.freeze([
      Object.freeze({
        animations: Object.freeze(["Silly Dancing"]),
        lines: Object.freeze([
          "They call this one the Rattle 'n Roll!",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Walkinglikezombie"]),
        lines: Object.freeze([
          "Brains? Nah, I'm more of a bones kinda guy.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Walkingsneakily"]),
        lines: Object.freeze([
          "Gotta stay quiet… don't wanna wake the dead. Oh wait—too late.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Defeated"]),
        lines: Object.freeze([
          "Well… that went about as smooth as a cactus pillow.",
        ]),
      }),
      Object.freeze({
        animations: Object.freeze(["Yelling Out"]),
        lines: Object.freeze([
          "YEEHAW! Still got some spirit left in me, don't I?",
        ]),
      }),
    ]),
  }),
]);

const DEFAULT_IDLE = BOB_ANIMATIONS[0];

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

async function play(name = DEFAULT_IDLE) {
  if (!mixer) return;
  if (!BOB_ANIMATIONS.includes(name)) {
    console.warn(`⚠️ Unknown animation requested: ${name}`);
    name = DEFAULT_IDLE;
  }
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
      play(DEFAULT_IDLE);
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

// ---------- MAIN BOOT ----------
async function initBob() {
  console.log("🟢 Bob v8.7 init");
  try {
    initThree();
    await loadRig();
    await play(DEFAULT_IDLE);
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

// ---------- GITHUB DELAY ----------
setTimeout(() => {
  console.log("🐎 GitHub delay complete — booting Bob...");
  initBob();
}, 3000);
