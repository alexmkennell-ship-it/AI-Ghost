// bob.js — v4.0 "FBX Personality Engine"
// - Loads FBX animations directly from R2 (no GLB conversion)
// - Keeps a single textured skinned mesh alive; crossfades clips
// - Onyx TTS, mic lock, amplitude-driven jaw/fingers
// - Cinematic 5.8m camera with slow yaw drift + auto head focus
// - Idle variety + skit system
// - 3-hour memory cache for mood & small talk

/////////////////////// CONFIG ///////////////////////
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/bob-animations/";
const TEX_URL    = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

// File names must match exactly (case/spacing as in bucket)
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
  // Core / idle family
  IDLE_NEUTRAL: "Neutral Idle",
  IDLE_BREATH:  "Breathing Idle",
  IDLE_LOOK:    "Looking Around",
  IDLE_BORED:   "Bored",
  IDLE_SAD:     "Sad Idle",

  // Sleep cycle
  LIE_DOWN:     "Lying Down",
  SLEEP:        "Sleeping Idle",
  SLEEP_ALT:    "Sleeping Idle (alt)",
  WAKE:         "Waking",
  DEFEATED:     "Defeated",

  // Motion
  WALK:         "Walking",
  WALK_STOP:    "Stop Walking",
  WALK_ZOMBIE:  "Walkinglikezombie",
  WALK_SNEAK:   "Walkingsneakily",

  // Conversational / gestures
  TALK:         "Talking",
  YELL:         "Yelling",
  YELL_OUT:     "Yelling Out",
  SHRUG:        "Shrugging",
  NO:           "Shaking Head No",
  WAVE:         "Waving",
  LAUGH:        "Laughing",

  // Fun
  DANCE_SILLY:  "Silly Dancing",
};

const idlePool = [
  ANIM.IDLE_NEUTRAL, ANIM.IDLE_BREATH, ANIM.IDLE_LOOK,
  ANIM.IDLE_BORED, ANIM.IDLE_SAD
];
const talkPool = [ANIM.TALK, ANIM.SHRUG, ANIM.NO, ANIM.LAUGH];
const funPool  = [ANIM.DANCE_SILLY];
const walkPool = [ANIM.WALK, ANIM.WALK_ZOMBIE, ANIM.WALK_SNEAK];

/////////////////////////////////////////////////////

// Globals
let scene, camera, renderer, clock, mixer;
let baseModel;              // skinned mesh root
let currentAction = null;   // THREE.AnimationAction
let actions = {};           // name -> AnimationAction
let clipsCache = {};        // name -> AnimationClip[]
let fbxCache = {};          // name -> FBX scene (first load only for clip extraction)
let statusEl, canvasContainer;

let state = "boot";
let micLocked = false;
let sleepLock = false;
let lastActivity = Date.now();

let audioCtx, analyser, srcNode, amplitudeRaf;
let jawBone = null, fingerBones = [];

let cam = { radius: 5.8, yaw: 0, pitch: 0.9 /* ~75deg */, drift: true, target: new THREE.Vector3(0,1.2,0) };
let focusBone = null;
let driftRAF = 0, renderRAF = 0;

// Cache (3 hours)
const TTL = 3*60*60*1000;
const K = { MOOD:"bob_mood", ORBIT:"bob_orbit", CHAT:"bob_chat" };
const now = ()=>Date.now();
const save = (k,v)=>localStorage.setItem(k, JSON.stringify({ts:now(), v}));
const load = (k,def)=>{ try{ const j=JSON.parse(localStorage.getItem(k)||"null"); if(j&&now()-j.ts<TTL) return j.v; }catch{} return def; };

// Utilities
const setStatus = (t)=>{ statusEl ??= document.getElementById("status"); if(statusEl) statusEl.textContent = t; };
const sleepMs = (ms)=>new Promise(r=>setTimeout(r,ms));
const pick = (a)=>a[Math.floor(Math.random()*a.length)];
const clamp = (v,a,b)=>Math.min(b,Math.max(a,v));
const lerp  = (a,b,t)=>a+(b-a)*t;

// Boot Three.js
async function initThree(){
  canvasContainer = document.getElementById("stage") || document.body;
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  canvasContainer.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = null;

  // Camera
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, cam.radius);

  // Light
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.8);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(2, 4, 3);
  scene.add(key);

  clock = new THREE.Clock();

  window.addEventListener("resize", ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Load base skinned model (from Neutral Idle) and apply texture
async function loadBaseModel(){
  const loader = new THREE.FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + FILES[ANIM.IDLE_NEUTRAL]);
  // Scale normalization if needed
  const scale = 0.01; // common for FBX; adjust if your model appears tiny/huge
  fbx.scale.setScalar(scale);

  // Find first skinned mesh root
  baseModel = fbx;
  scene.add(baseModel);

  // Texture
  const tex = await new THREE.TextureLoader().loadAsync(TEX_URL);
  tex.flipY = false;
  baseModel.traverse(o=>{
    if(o.isMesh){
      o.material.skinning = true;
      o.material.map = tex;
      o.material.needsUpdate = true;
      o.castShadow = false; o.receiveShadow = false;
    }
    if(o.isBone && /jaw|chin/i.test(o.name)) jawBone = o;
    if(o.isBone && /(finger|thumb|hand|wrist)/i.test(o.name) && fingerBones.length<10) fingerBones.push(o);
    if(o.isBone && /head|neck|spine2/i.test(o.name) && !focusBone) focusBone = o;
  });

  mixer = new THREE.AnimationMixer(baseModel);
  // cache the base model's default clips if any
  if(fbx.animations?.length){
    clipsCache[ANIM.IDLE_NEUTRAL] = fbx.animations;
  }
}

// Load FBX once, extract clips, reuse on base skeleton
async function loadClipsFor(name){
  if(clipsCache[name]) return clipsCache[name];
  if(!FILES[name]) { console.warn("No FBX file mapped for", name); return []; }
  if(!fbxCache[name]){
    const loader = new THREE.FBXLoader();
    const fbx = await loader.loadAsync(FBX_BASE + FILES[name]);
    fbxCache[name] = fbx;
  }
  const fbx = fbxCache[name];
  const clips = (fbx.animations||[]).map(c=>c.clone());
  clipsCache[name] = clips;
  return clips;
}

// Crossfade to animation by category name (uses first clip)
async function play(name, {fade=0.35, loop=true, minHold=0.6}={}){
  if(!mixer) return;
  const clips = await loadClipsFor(name);
  if(!clips.length){ console.warn("No clips for", name); return; }
  const clip = clips[0];

  const newAction = mixer.clipAction(clip);
  newAction.reset();
  newAction.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce, Infinity);
  newAction.clampWhenFinished = !loop;
  newAction.enabled = true;

  if(currentAction){
    currentAction.crossFadeTo(newAction, fade, false);
  }else{
    newAction.fadeIn(fade);
  }
  newAction.play();
  currentAction = newAction;

  if(minHold>0) await sleepMs(minHold*1000);
}

// Camera drift + focus
function updateCamera(dt){
  // yaw drift when idle
  if(state==="idle" && cam.drift){
    cam.yaw += Math.sin(performance.now()*0.00015)*0.002; // subtle wobble
  }
  const r = cam.radius; // fixed clamp
  const y = cam.pitch;
  const xz = r * Math.cos(y);
  camera.position.set(
    cam.target.x + xz * Math.sin(cam.yaw),
    cam.target.y + r * Math.sin(y),
    cam.target.z + xz * Math.cos(cam.yaw)
  );
  camera.lookAt(cam.target);
  // focus head if available
  if(focusBone && focusBone.getWorldPosition){
    const p = new THREE.Vector3();
    focusBone.getWorldPosition(p);
    // smooth follow
    cam.target.lerp(p, 0.08);
  }
}

// Render loop
function startRender(){
  cancelAnimationFrame(renderRAF);
  const tick = ()=>{
    const dt = clock.getDelta();
    mixer?.update(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
    renderRAF = requestAnimationFrame(tick);
  };
  renderRAF = requestAnimationFrame(tick);
}

// Amplitude-driven bones
function startAmplitudeDriveFor(audio){
  stopAmplitudeDrive();
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024;
    srcNode  = audioCtx.createMediaElementSource(audio);
    srcNode.connect(analyser); analyser.connect(audioCtx.destination);
    const data = new Uint8Array(analyser.fftSize);
    const step = ()=>{
      analyser.getByteTimeDomainData(data);
      let sum=0; for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
      const rms = Math.sqrt(sum/data.length);
      const amp = clamp(rms*7, 0, 1);

      if(jawBone){ jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, -amp*0.5, 0.35); }
      for(const b of fingerBones){
        if(!b.rotation) continue;
        b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, amp*0.22, 0.25);
      }
      amplitudeRaf = requestAnimationFrame(step);
    };
    amplitudeRaf = requestAnimationFrame(step);
  }catch(e){ console.warn("Amp drive unavailable:", e); }
}
function stopAmplitudeDrive(){ if(amplitudeRaf) cancelAnimationFrame(amplitudeRaf); amplitudeRaf=0;
  try{ srcNode?.disconnect(); analyser?.disconnect(); }catch{} srcNode=null; analyser=null; }

// Speech pipeline
async function speakAndAnimate(userText){
  if(!userText) return;
  try{
    state="talking";
    setStatus("💬 Thinking...");
    await play(pick(talkPool), {fade:0.25, loop:true, minHold:0.2});

    // Chat
    const resp = await fetch(`${WORKER_URL}/`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ prompt: userText })
    });
    const data = await resp.json();
    const reply = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖", reply);

    // TTS
    const r = await fetch(`${WORKER_URL}/tts`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ text: reply, voice: "onyx" })
    });
    if(!r.ok){ setStatus("⚠️ TTS error"); state="idle"; await play(ANIM.IDLE_NEUTRAL,{fade:0.4}); return; }
    const buf = await r.arrayBuffer();
    const audio = new Audio(URL.createObjectURL(new Blob([buf],{type:"audio/mpeg"})));
    audio.playbackRate = 0.92; audio.preservesPitch = false;

    micLocked=true; if(window.recognition) try{window.recognition.stop();}catch{}
    audio.addEventListener("play", ()=> startAmplitudeDriveFor(audio), { once:true });
    await audio.play().catch(()=>{});
    audio.onended = async ()=>{
      stopAmplitudeDrive();
      micLocked=false; if(window.recognition) try{window.recognition.start();}catch{}
      state="idle"; setStatus("👂 Listening...");
      await play(pick([ANIM.IDLE_NEUTRAL, ANIM.IDLE_BREATH, ANIM.IDLE_LOOK]), {fade:0.35});
    };
  }catch(e){
    console.error(e);
    state="idle"; await play(ANIM.IDLE_NEUTRAL,{fade:0.4});
  }
}

// Skits (random one-liners)
const SKITS = {
  [ANIM.IDLE_BORED]: [
    "Ain’t much goin’ on… just me and my thoughts rattlin’.",
    "If boredom were gold, I’d be richer than a ghost king."
  ],
  [ANIM.IDLE_LOOK]: [
    "Keepin’ an eye socket out for trouble.",
    "Seen any tumbleweeds rollin’ by?"
  ],
  [ANIM.DANCE_SILLY]: [
    "They call this one the Rattle-‘n-Roll!",
    "Careful—I might shake a femur loose!"
  ],
  [ANIM.WAVE]: [
    "Howdy! Don’t mind the creaks—adds character.",
  ],
  [ANIM.WAKE]: [
    "Whoo-wee… dreamt I was a scarecrow with a 401K.",
  ],
};
async function saySkitFor(name){
  const lines = SKITS[name]; if(!lines || !lines.length) return;
  const line = pick(lines);
  try{
    micLocked=true; if(window.recognition) try{window.recognition.stop();}catch{}
    const r = await fetch(`${WORKER_URL}/tts`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ text: line, voice: "onyx" })
    });
    if(!r.ok){ micLocked=false; if(window.recognition) try{window.recognition.start();}catch{}; return; }
    const buf = await r.arrayBuffer();
    const audio = new Audio(URL.createObjectURL(new Blob([buf],{type:"audio/mpeg"})));
    audio.playbackRate = 0.95; audio.preservesPitch = false;
    audio.addEventListener("play", ()=> startAmplitudeDriveFor(audio), { once:true });
    await audio.play().catch(()=>{});
    audio.onended = ()=>{ stopAmplitudeDrive(); micLocked=false; if(window.recognition) try{window.recognition.start();}catch{}; };
  }catch{ micLocked=false; if(window.recognition) try{window.recognition.start();}catch{} }
}

// Idle variety + sleep cycle
function scheduleIdle(){
  const next = 12000 + Math.random()*12000;
  setTimeout(async ()=>{
    if(state!=="idle"){ scheduleIdle(); return; }
    lastActivity = Date.now();

    // 10% fun, 20% walk, 50% idle, 5% wave, 15% look/bored/sad variety
    const r = Math.random();
    let name = ANIM.IDLE_NEUTRAL;
    if(r<0.10) name = pick(funPool);
    else if(r<0.30) name = pick(walkPool);
    else if(r<0.35) name = ANIM.WAVE;
    else if(r<0.50) name = pick([ANIM.IDLE_LOOK, ANIM.IDLE_BORED, ANIM.IDLE_SAD]);
    else name = pick([ANIM.IDLE_NEUTRAL, ANIM.IDLE_BREATH]);

    await play(name, {fade:0.35, loop:true});
    saySkitFor(name);

    // ~8% chance to doze off post-action
    if(Math.random()<0.08 && !sleepLock){
      await fallAsleep();
    }

    scheduleIdle();
  }, next);
}

async function fallAsleep(){
  if(state!=="idle" || sleepLock) return;
  sleepLock=true; state="sleeping";
  setStatus("😴 Nodding off…");
  // lie down -> sleep
  await play(ANIM.LIE_DOWN, {fade:0.45, loop:false, minHold:0.5});
  await play(ANIM.SLEEP,    {fade:0.45, loop:true,  minHold:1.2});
  // camera dolly out a touch
  await smoothDolly(7.2, 1.0);
}

async function wakeUp(){
  if(state!=="sleeping") return;
  setStatus("😮 Waking up…");
  await smoothDolly(5.8, 0.9);
  await play(ANIM.WAKE,  {fade:0.45, loop:false, minHold:0.4});
  await play(ANIM.IDLE_NEUTRAL, {fade:0.45, loop:true});
  state="idle"; sleepLock=false; setStatus("👂 Listening...");
  saySkitFor(ANIM.WAKE);
}

// Dolly (radius only), clamp to [5.8, 8.0]
async function smoothDolly(target, secs=1.0){
  const start = cam.radius;
  const end   = clamp(target, 5.8, 8.0);
  const t0 = performance.now(), dur=secs*1000;
  return new Promise(res=>{
    const step = (t)=>{
      const k = Math.min((t-t0)/dur, 1);
      const e = 0.5 - 0.5*Math.cos(Math.PI*k);
      cam.radius = lerp(start, end, e);
      if(k<1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

// Microphone
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if(window.SpeechRecognition){
  const rec = new SpeechRecognition();
  rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
  window.recognition = rec;

  rec.onresult = async (e)=>{
    const t = e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    if(!t) return;
    console.log("🎤", t);
    lastActivity = Date.now();

    if(state==="sleeping" && /hey\s*bob/.test(t)){ await wakeUp(); return; }
    await speakAndAnimate(t);
  };
  rec.onerror = e=>console.warn("Speech error:", e.error);
  rec.onend   = ()=>{ if(!micLocked && state!=="sleeping") rec.start(); };

  window.addEventListener("click", ()=>{ try{ rec.start(); setStatus("👂 Listening (mic on)…"); }catch{} }, { once:true });
}else{
  console.warn("No SpeechRecognition in this browser.");
}

// Camera init + drift
function startDrift(){
  if(driftRAF) cancelAnimationFrame(driftRAF);
  const baseYaw = cam.yaw;
  const t0 = performance.now();
  const tick = (t)=>{
    if(state==="idle" && cam.drift){
      const e = (t-t0)/1000;
      cam.yaw = baseYaw + Math.sin(e*0.15)*0.09; // ±5°
    }
    driftRAF = requestAnimationFrame(tick);
  };
  driftRAF = requestAnimationFrame(tick);
}

// Boot
async function boot(){
  console.log("🟢 Booting Bob 4.0 (FBX) …");
  statusEl = document.getElementById("status");
  setStatus("Initializing renderer…");
  await ensureThreeDeps();
  await initThree();

  setStatus("Loading skeleton …");
  await loadBaseModel();

  setStatus("Preloading key animations …");
  await Promise.all([
    loadClipsFor(ANIM.IDLE_NEUTRAL),
    loadClipsFor(ANIM.TALK),
    loadClipsFor(ANIM.LIE_DOWN),
    loadClipsFor(ANIM.SLEEP),
    loadClipsFor(ANIM.WAKE),
  ]).catch(()=>{});

  await play(ANIM.IDLE_NEUTRAL, {fade:0.3});
  cam.radius = 5.8; cam.pitch = 1.308996939; // ~75deg
  cam.yaw = 0;

  startRender();
  startDrift();
  scheduleIdle();

  state="idle"; setStatus("👂 Listening…");
  console.log("🎉 Bob ready!");
}

// Three.js & loaders guard (if not already on page)
async function ensureThreeDeps(){
  if(window.THREE && THREE.FBXLoader) return;
  // Load Three + FBXLoader from CDN (no internet? host locally)
  if(!window.THREE){
    await import("https://unpkg.com/three@0.160.0/build/three.module.js").then(mod=>{ window.THREE = mod; });
  }
  if(!THREE.FBXLoader){
    const { FBXLoader } = await import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/FBXLoader.js");
    THREE.FBXLoader = FBXLoader;
  }
}

// Wake on click if sleeping
document.addEventListener("pointerdown", ()=>{
  lastActivity = Date.now();
  if(state==="sleeping") wakeUp();
},{passive:true});

window.addEventListener("DOMContentLoaded", ()=> boot());
