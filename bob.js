// bob.js — Expressive Build 2.6
// • Universal smooth transitions (same feel as talk, everywhere)
// • Sleep zoom-out + guaranteed zoom-in reset on wake
// • Guaranteed stand-up on wake (shrug → idle)
// • Pose carryover (no snaps), anim locking (no overlap)
// • Raspy ONYX voice w/ mic-lock, amplitude jaw/fingers, mood eyes, micro-idle

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// Anim names (from your GLBs)
const ANIM = {
  IDLE_MAIN: "Animation_Long_Breathe_and_Look_Around_withSkin",
  SLEEP: "Animation_Sleep_Normally_withSkin",
  ANGRY: "Animation_Angry_Ground_Stomp_withSkin",
  SHRUG: "Animation_Shrug_withSkin",
  TALK_1: "Animation_Talk_Passionately_withSkin",
  TALK_2: "Animation_Talk_with_Hands_Open_withSkin",
  TALK_3: "Animation_Talk_with_Left_Hand_Raised_withSkin",
  TALK_4: "Animation_Talk_with_Right_Hand_Open_withSkin",
  YAWN: "Animation_Yawn_withSkin",
};

const idleVariety = [ANIM.IDLE_MAIN, ANIM.SHRUG, ANIM.YAWN];
const talkPool   = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4];

// DOM / state
let mvA, mvB, activeMV, inactiveMV, statusEl;
let state = "boot";
let micLocked = false;
let animLock = false;
let sleepLock = false;
let lastAnimName = null;

const glbCache = new Map();
const inflight  = new Map();
window.recognition = null;

// ---------- utils ----------
const setStatus = (m) => (statusEl ??= document.getElementById("status")) && (statusEl.textContent = m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick  = (a)  => a[Math.floor(Math.random() * a.length)];
const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
const lerp  = (a,b,t) => a + (b - a) * t;
const doubleRaf = async () => { await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r)); };

function setCameraOrbit(orbit) { if (activeMV) activeMV.setAttribute("camera-orbit", orbit); }

// Easing helper for pose lerp timing (ease-in-out)
const easeIO = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;

// ---------- loader ----------
async function ensureGlbUrl(name){
  if (glbCache.has(name))  return glbCache.get(name);
  if (inflight.has(name))  return inflight.get(name);
  const p = (async () => {
    const res = await fetch(`${MODEL_BASE}${name}.glb`, { mode: "cors" });
    if (!res.ok) throw new Error(`Failed GLB ${name}: ${res.status}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    glbCache.set(name, url);
    return url;
  })();
  inflight.set(name, p);
  try { return await p; } finally { inflight.delete(name); }
}
async function waitForModelLoaded(mv){
  if (mv?.model) { await doubleRaf(); return; }
  await new Promise(res => {
    const on = () => (mv.removeEventListener("load", on), res());
    mv.addEventListener("load", on, { once:true });
  });
  await doubleRaf();
}
function getThreeScene(mv){ return mv?.model?.scene || mv?.scene || null; }

// ---------- bones / eyes ----------
let jawBone=null, fingerBones=[], eyeMeshes=[];
let boneSearchDone=false, eyeSearchDone=false;

function fuzzyBoneFind(scene){
  if (!scene) return { jaw:null, fingers:[] };
  let jaw=null; const fingers=[];
  scene.traverse?.(o=>{
    const n=o.name||"";
    if(!jaw && /jaw|chin/i.test(n)) jaw=o;
    if(/finger|hand|wrist|thumb/i.test(n)) fingers.push(o);
  });
  return { jaw, fingers };
}
function fuzzyEyeFind(scene){
  if (!scene) return [];
  const eyes=[];
  scene.traverse?.(o=>{
    if(/eye|pupil|iris/i.test(o.name||"") && o.material) eyes.push(o);
  });
  return eyes.slice(0,4);
}
function ensureBindings(){
  const s=getThreeScene(activeMV); if(!s) return;
  if (!boneSearchDone){
    const { jaw, fingers } = fuzzyBoneFind(s);
    jawBone = jaw;
    fingerBones = fingers.slice(0,6);
    boneSearchDone = true;
  }
  if (!eyeSearchDone){
    eyeMeshes = fuzzyEyeFind(s);
    eyeSearchDone = true;
  }
}
function setEmotionEyesFromText(text){
  ensureBindings(); if (!eyeMeshes.length) return;
  const t=(text||"").toLowerCase();
  let color={r:.2,g:.9,b:.2}, intensity=.6;
  if (/angry|mad|rage/.test(t)) { color={r:1,g:.2,b:.1}; intensity=1.2; }
  else if (/sleep|tired|yawn/.test(t)) { color={r:1,g:.7,b:.2}; intensity=.4; }
  else if (/mischief|trick|sneak/.test(t)) { color={r:.95,g:.5,b:1}; intensity=.9; }
  for (const m of eyeMeshes){
    if (!m.material) continue;
    if (m.material.emissive) m.material.emissive.setRGB(color.r*intensity, color.g*intensity, color.b*intensity);
    if (m.material.emissiveIntensity!==undefined) m.material.emissiveIntensity = clamp(intensity,.2,2);
  }
}

// ---------- amplitude jaw/fingers ----------
let audioCtx, analyser, srcNode, amplitudeRAF;
function startAmplitudeDriveFor(audio){
  stopAmplitudeDrive();
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
    const sNode = audioCtx.createMediaElementSource(audio);
    srcNode = sNode;
    sNode.connect(analyser); analyser.connect(audioCtx.destination);
    const data = new Uint8Array(analyser.fftSize);
    const jawS={v:0}, fingerS={v:0};

    const drive = () => {
      analyser.getByteTimeDomainData(data);
      let sum=0; for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
      const rms=Math.sqrt(sum/data.length);
      const amp=clamp(rms*6,0,1);
      jawS.v    = jawS.v*0.7 + amp*0.3;
      fingerS.v = fingerS.v*0.8 + amp*0.2;

      ensureBindings();
      if (jawBone?.rotation) jawBone.rotation.x = -jawS.v*0.45;
      for (const b of fingerBones) if (b.rotation){
        const bend = fingerS.v*0.25;
        b.rotation.x = (b.rotation.x||0) - bend*0.15;
        b.rotation.z = (b.rotation.z||0) + bend*0.05;
      }
      amplitudeRAF = requestAnimationFrame(drive);
    };
    amplitudeRAF = requestAnimationFrame(drive);
  }catch(e){ console.warn("Audio analysis unavailable:", e); }
}
function stopAmplitudeDrive(){
  if (amplitudeRAF) cancelAnimationFrame(amplitudeRAF);
  amplitudeRAF=0; try{ srcNode?.disconnect(); analyser?.disconnect(); }catch{}
  srcNode=null; analyser=null;
}

// ---------- pose capture / apply ----------
function capturePose(mv){
  const s=getThreeScene(mv); if(!s) return {};
  const pose={};
  s.traverse?.(o=>{ if (o.isBone) pose[o.name]={ r:o.rotation.clone(), p:o.position.clone() }; });
  return pose;
}
function applyPose(mv,pose){
  const s=getThreeScene(mv); if(!s||!pose) return;
  s.traverse?.(o=>{
    const p=pose[o.name];
    if (p){ o.rotation.copy(p.r); o.position.copy(p.p); }
  });
}

// Dynamic blend time based on posture shift
function calcBlendMs(nextName, prevName){
  if (!prevName) return 300;
  const bigShift = (a,b) => {
    // crude categories: sleep vs anything; talk vs idle; otherwise mild
    const sleepish = (x)=>x===ANIM.SLEEP;
    const talkish  = (x)=>/^Animation_Talk/.test(x);
    if (sleepish(a) !== sleepish(b)) return 700;
    if (talkish(a)  !== talkish(b))  return 400;
    return 250;
  };
  return bigShift(nextName, prevName);
}

// ---------- global animation (universal smoothing) ----------
async function setAnim(name, { minHoldMs = 700, blendMs } = {}){
  if (animLock) return;
  animLock = true;
  try{
    const prevName = lastAnimName;
    const pose     = capturePose(activeMV);

    const bm = blendMs ?? calcBlendMs(name, prevName);

    // fade OUT current
    activeMV?.classList.remove("active");
    await sleep(bm);

    // load next hidden
    const url = await ensureGlbUrl(name);
    inactiveMV.setAttribute("src", url);
    await waitForModelLoaded(inactiveMV);

    // apply pose carryover for continuity
    applyPose(inactiveMV, pose);

    // start next + fade IN
    try { inactiveMV.currentTime = 0; await inactiveMV.play(); } catch {}
    inactiveMV.classList.add("active");
    await sleep(bm);

    // swap
    [activeMV, inactiveMV] = [inactiveMV, activeMV];
    boneSearchDone = false; eyeSearchDone = false;
    lastAnimName = name;

    if (minHoldMs > 0) await sleep(minHoldMs);
  } finally {
    animLock = false;
  }
}

// ---------- micro-idle ----------
let microIdleRAF=0, microIdleActive=false;
function startMicroIdle(){
  if (microIdleRAF) return;
  microIdleActive = true;
  const phase = Math.random() * Math.PI*2;
  const tick = () => {
    if (!microIdleActive || state !== "idle"){ microIdleRAF=requestAnimationFrame(tick); return; }
    ensureBindings();
    const s=getThreeScene(activeMV);
    if (s){
      const head = jawBone?.parent;
      const k = Math.sin(performance.now()/1000*0.6 + phase) * 0.03;
      if (head?.rotation){
        head.rotation.y = lerp(head.rotation.y, k, 0.05);
        head.rotation.x = lerp(head.rotation.x, -k*0.5, 0.05);
      }
    }
    microIdleRAF = requestAnimationFrame(tick);
  };
  microIdleRAF = requestAnimationFrame(tick);
}
function stopMicroIdle(){ microIdleActive=false; if(microIdleRAF) cancelAnimationFrame(microIdleRAF); microIdleRAF=0; }

// ---------- speak (AI + TTS) ----------
let abortSpeech=null;
async function speakAndAnimate(userText){
  if (!userText) return;
  try{
    state="talking"; stopMicroIdle(); setStatus("💬 Thinking...");

    // Chat
    const chat = await fetch(`${WORKER_URL}/`, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ prompt: userText })
    });
    const data  = await chat.json();
    const reply = data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:", reply);
    setEmotionEyesFromText(reply);

    // TTS w/ retry
    const ac = new AbortController(); let buf=null;
    for (let i=0;i<2;i++){
      try{
        const r = await fetch(`${WORKER_URL}/tts`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ text: reply, voice: "onyx" }),
          signal: ac.signal
        });
        if (!r.ok){ await r.text(); continue; }
        buf = await r.arrayBuffer(); break;
      }catch{ /* retry */ }
    }
    if (!buf){ setStatus("⚠️ Couldn't speak"); state="idle"; startMicroIdle(); return; }

    // Audio & mic lock
    const audio = new Audio(URL.createObjectURL(new Blob([buf], { type:"audio/mpeg" })));
    audio.playbackRate = 0.9; audio.preservesPitch = false;
    micLocked=true; if (window.recognition) try{ window.recognition.stop(); }catch{}

    audio.addEventListener("play", async ()=>{
      await setAnim(pick(talkPool), { minHoldMs:0, blendMs: calcBlendMs("talk", lastAnimName) });
      // keep swapping talk clips lightly
      const loop = () => {
        if (state!=="talking" || audio.paused || audio.ended) return;
        setTimeout(()=>{ if (state==="talking" && !audio.ended)
          setAnim(pick(talkPool), { minHoldMs:0, blendMs:250 }); }, 2000 + Math.random()*500);
      };
      loop();
      startAmplitudeDriveFor(audio);
    }, { once:true });

    await audio.play().catch(console.warn);

    audio.onended = async () => {
      stopAmplitudeDrive();
      state="idle"; setStatus("👂 Listening...");
      await setAnim(pick(idleVariety), { minHoldMs:600, blendMs: calcBlendMs(ANIM.IDLE_MAIN, lastAnimName) });
      micLocked=false; if (window.recognition) try{ window.recognition.start(); }catch{}
      startMicroIdle();
    };
  }catch(e){
    console.error("Speech error:", e);
    stopAmplitudeDrive(); state="idle"; micLocked=false; startMicroIdle();
  }
}

// ---------- sleep logic (randomized) ----------
let lastActivity = Date.now();
function bumpActivity(){ lastActivity = Date.now(); }

async function maybeSleep(){
  if (state!=="idle" || sleepLock) return;
  if (Math.random() < 0.25){
    sleepLock = true;
    state = "sleeping";
    stopMicroIdle();
    setStatus("😴 Nodding off...");
    setCameraOrbit("0deg 90deg 3m");              // zoom out while sleeping
    await setAnim(ANIM.SLEEP, { minHoldMs: 1800, blendMs: calcBlendMs(ANIM.SLEEP, lastAnimName) });
    // stays sleeping until woken (voice or click)
  }
}
setInterval(async () => {
  if (state==="idle" && Date.now() - lastActivity > 40000) await maybeSleep();
}, 1000);

// Stand-up sequence (guaranteed upright & camera reset)
async function standUpSequence(){
  setCameraOrbit("0deg 75deg 1.8m");              // zoom back in
  await setAnim(ANIM.SHRUG,     { minHoldMs: 400, blendMs: 600 });
  await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 500 });
  startMicroIdle();
  state="idle";
  sleepLock=false;                                  // allow future naps
  setStatus("👂 Listening...");
}

// Click wake (fallback)
document.addEventListener("pointerdown", () => {
  bumpActivity();
  if (state === "sleeping"){
    state = "waking";
    standUpSequence();
  }
}, { passive:true });

// ---------- microphone ----------
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (window.SpeechRecognition){
  const rec = new SpeechRecognition();
  rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
  window.recognition = rec;

  rec.onresult = async (e) => {
    const t = e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    if (!t) return;
    console.log("🎤 Heard:", t);

    // Voice wake
    if (state==="sleeping" && /hey\s*bob/.test(t)){
      state = "waking";
      await standUpSequence();
      return;
    }

    await speakAndAnimate(t);
  };
  rec.onerror = (e) => console.warn("Speech recognition error:", e.error);
  rec.onend   = () => { if (!micLocked && state!=="sleeping") rec.start(); };

  // user gesture to unlock mic first time
  window.addEventListener("click", () => {
    try{ rec.start(); setStatus("👂 Listening (mic on)..."); }catch{}
  }, { once:true });
}else{
  console.warn("SpeechRecognition not supported.");
}

// ---------- warmup / boot ----------
async function warmup(){
  const warm = new Set([ANIM.IDLE_MAIN, ANIM.SHRUG, ANIM.SLEEP, ...talkPool]);
  let d=100; for (const n of warm){ setTimeout(()=>ensureGlbUrl(n).catch(()=>{}), d); d+=100; }
}

async function boot(){
  try{
    console.log("🟢 Booting Bob...");
    statusEl = document.getElementById("status");
    mvA = document.getElementById("mvA");
    mvB = document.getElementById("mvB");
    if (!mvA || !mvB){ setStatus("Error: model-viewer not found"); return; }

    activeMV   = mvA;
    inactiveMV = mvB;
    activeMV.classList.add("active");

    setStatus("Warming up…");
    await warmup();
    console.log("✅ Warmup complete");

    await setAnim(ANIM.IDLE_MAIN, { minHoldMs: 800, blendMs: 300 });
    state="idle"; lastActivity=Date.now();
    startMicroIdle();
    setCameraOrbit("0deg 75deg 1.8m");

    document.addEventListener("keydown", (e)=>{
      if (e.key.toLowerCase()==="p") speakAndAnimate("Howdy partner! Ready to rustle up some mischief?");
    });

    console.log("🎉 Bob ready!");
  }catch(e){
    console.error("Boot error:", e);
    setStatus("⚠️ Failed to load Bob");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  console.log("📦 DOMContentLoaded — launching boot()");
  boot();
});

window.Bob = { setAnim, speak: speakAndAnimate, state: () => state };
