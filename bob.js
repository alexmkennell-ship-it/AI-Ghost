// bob.js — v4.1 “Global Stability Build”
// One global THREE instance, no ESM imports. Fully compatible with <script> tags.

/////////////////////////////////////////////////////
// CONFIG
/////////////////////////////////////////////////////
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/";
const TEX_URL = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

/////////////////////////////////////////////////////
// LOAD THREE.JS + FBXLoader (global-safe)
/////////////////////////////////////////////////////
async function ensureThreeReady() {
  if (window.THREE && THREE.FBXLoader) return;

  // 1️⃣ Load THREE (global)
  if (!window.THREE) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/three@0.160.0/build/three.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    console.log("✅ THREE.js loaded");
  }

  // 2️⃣ Load FBXLoader (attaches to global THREE)
  if (!THREE.FBXLoader) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/three@0.160.0/examples/js/loaders/FBXLoader.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    console.log("✅ FBXLoader loaded");
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
  "Waking": "Waking.fbx",
  "Lying Down": "Lying Down.fbx",
  "Talking": "Talking.fbx",
  "Shrugging": "Shrugging.fbx",
  "Waving": "Waving.fbx",
  "Laughing": "Laughing.fbx",
  "Silly Dancing": "Silly Dancing.fbx"
};

const ANIM = {
  IDLE_NEUTRAL: "Neutral Idle",
  IDLE_BREATH: "Breathing Idle",
  IDLE_LOOK: "Looking Around",
  IDLE_BORED: "Bored",
  IDLE_SAD: "Sad Idle",
  LIE_DOWN: "Lying Down",
  SLEEP: "Sleeping Idle",
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

/////////////////////////////////////////////////////
// UTILITIES
/////////////////////////////////////////////////////
const setStatus = (m) => (document.getElementById("status") || {}).textContent = m || "";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/////////////////////////////////////////////////////
// SCENE SETUP
/////////////////////////////////////////////////////
let scene, camera, renderer, mixer, baseModel, currentAction;
let clock, jawBone = null, fingerBones = [], focusBone = null;
let state = "boot", micLocked = false, sleepLock = false;
let cam = { radius: 5.8, yaw: 0, pitch: 1.3, drift: true, target: new THREE.Vector3(0, 1.2, 0) };

async function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, cam.radius);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(3, 5, 2);
  scene.add(light, new THREE.AmbientLight(0x888888));

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
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[ANIM.IDLE_NEUTRAL]);
  fbx.scale.setScalar(0.01);
  scene.add(fbx);
  baseModel = fbx;

  const tex = new THREE.TextureLoader().load(TEX_URL);
  tex.flipY = false;
  baseModel.traverse(o => {
    if (o.isMesh) {
      o.material.map = tex;
      o.material.needsUpdate = true;
    }
    if (/jaw|chin/i.test(o.name)) jawBone = o;
    if (/(finger|thumb|hand|wrist)/i.test(o.name) && fingerBones.length < 10) fingerBones.push(o);
    if (/head|neck|spine2/i.test(o.name) && !focusBone) focusBone = o;
  });

  mixer = new THREE.AnimationMixer(baseModel);
}

/////////////////////////////////////////////////////
// ANIMATION CONTROL
/////////////////////////////////////////////////////
let clipsCache = {}, fbxCache = {};

async function loadClips(name) {
  if (clipsCache[name]) return clipsCache[name];
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
  fbxCache[name] = fbx;
  const clips = (fbx.animations || []).map(c => c.clone());
  clipsCache[name] = clips;
  return clips;
}

async function play(name, { fade = 0.4, loop = true } = {}) {
  if (!mixer) return;
  const clips = await loadClips(name);
  if (!clips.length) return;
  const clip = clips[0];
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  if (currentAction) currentAction.crossFadeTo(action, fade, false);
  action.play();
  currentAction = action;
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

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  updateCamera();
  renderer.render(scene, camera);
}

/////////////////////////////////////////////////////
// AUDIO / TTS
/////////////////////////////////////////////////////
function startAmplitude(audio) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
    const src = ctx.createMediaElementSource(audio);
    src.connect(analyser); analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i]-128)/128; sum += v*v; }
      const rms = Math.sqrt(sum/data.length), amp = clamp(rms*6,0,1);
      if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, -amp*0.5, 0.35);
      for (const b of fingerBones) if (b.rotation) b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, amp*0.2, 0.3);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch(e){ console.warn(e); }
}

async function speakAndAnimate(text){
  if(!text)return;
  state="talking"; setStatus("💬 Thinking...");
  await play(pick(talkPool));
  const r=await fetch(`${WORKER_URL}/`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:text})});
  const j=await r.json(); const reply=j.reply||"Well shoot, reckon I'm tongue-tied, partner.";
  const tts=await fetch(`${WORKER_URL}/tts`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:reply,voice:"onyx"})});
  const buf=await tts.arrayBuffer();
  const audio=new Audio(URL.createObjectURL(new Blob([buf],{type:"audio/mpeg"})));
  audio.playbackRate=0.92; audio.preservesPitch=false;
  audio.addEventListener("play",()=>startAmplitude(audio),{once:true});
  await audio.play();
  audio.onended=async()=>{state="idle";setStatus("👂 Listening...");await play(pick(idlePool));};
}

/////////////////////////////////////////////////////
// IDLE + SLEEP
/////////////////////////////////////////////////////
async function fallAsleep(){
  if(state!=="idle"||sleepLock)return;
  sleepLock=true;state="sleeping";setStatus("😴 Nodding off…");
  await play(ANIM.LIE_DOWN,{loop:false});
  await play(ANIM.SLEEP);
  cam.radius=7.2;
}
async function wakeUp(){
  if(state!=="sleeping")return;
  cam.radius=5.8;setStatus("😮 Waking up…");
  await play(ANIM.WAKE,{loop:false});
  await play(ANIM.IDLE_NEUTRAL);
  state="idle";sleepLock=false;setStatus("👂 Listening...");
}

function scheduleIdle(){
  setTimeout(async()=>{
    if(state!=="idle")return scheduleIdle();
    let n=pick(idlePool);
    if(Math.random()<0.1)n=pick(funPool);
    await play(n);
    if(Math.random()<0.08&&!sleepLock)await fallAsleep();
    scheduleIdle();
  },12000+Math.random()*12000);
}

/////////////////////////////////////////////////////
// MIC + BOOT
/////////////////////////////////////////////////////
window.SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(window.SpeechRecognition){
  const rec=new SpeechRecognition();
  rec.continuous=true;rec.interimResults=false;rec.lang="en-US";
  rec.onresult=async(e)=>{
    const t=e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    if(!t)return;
    if(state==="sleeping"&&/hey\s*bob/.test(t))return await wakeUp();
    await speakAndAnimate(t);
  };
  rec.onend=()=>{if(!micLocked&&state!=="sleeping")rec.start();};
  window.addEventListener("click",()=>{try{rec.start();setStatus("👂 Listening (mic on)…");}catch{}},{once:true});
}

/////////////////////////////////////////////////////
// BOOT
/////////////////////////////////////////////////////
async function boot(){
  setStatus("🟢 Booting Bob …");
  await ensureThreeReady();
  await initScene();
  await loadModel();
  await play(ANIM.IDLE_NEUTRAL);
  animate();
  scheduleIdle();
  state="idle"; setStatus("👂 Listening…");
  console.log("🎉 Bob ready!");
}
window.addEventListener("DOMContentLoaded",boot);
