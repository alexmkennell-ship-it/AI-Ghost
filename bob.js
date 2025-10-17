// bob.js — Expressive Build 2.9 “Living Bob”
// • Universal smooth transitions + pose carryover (no ghosting)
// • Camera: dolly-only 1.8m↔3.2m + subtle yaw drift (no zoom-in beyond 1.8m)
// • Wake path: Wake_Up → Stand_Up1 → Idle (guaranteed stand-up)
// • Idle variety: run/stagger/play/alerts/sleep (weighted), optional sleep after skit
// • Spoken idle “skits” via TTS (voice: onyx), mic-lock safe (no self-hear)
// • 3-hour local memory (chat, mood, camera orbit)
// • Graceful model fallbacks (no hard fails if a GLB is missing)

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

// ---------- Anim names from your R2 ----------
const ANIM = {
  IDLE_MAIN: "Animation_Long_Breathe_and_Look_Around_withSkin",
  IDLE_PLAY: "Animation_Indoor_Play_withSkin",
  IDLE_STAG: "Animation_Mummy_Stagger_withSkin",
  IDLE_RUN:  "Animation_Running_withSkin",
  WALK:      "Animation_Walking_withSkin",

  SLEEP:     "Animation_Sleep_Normally_withSkin",
  WAKE_UP:   "Animation_Wake_Up_and_Look_Up_withSkin",
  STAND_UP:  "Animation_Stand_Up1_withSkin",

  ALERT:     "Animation_Alert_withSkin",
  ALERT_R:   "Animation_Alert_Quick_Turn_Right_withSkin",
  SHRUG:     "Animation_Shrug_withSkin",
  AGREE:     "Animation_Agree_Gesture_withSkin",

  ANGRY:     "Animation_Angry_Ground_Stomp_withSkin",
  TANTRUM:   "Animation_Angry_To_Tantrum_Sit_withSkin",

  TALK_1:    "Animation_Talk_Passionately_withSkin",
  TALK_2:    "Animation_Talk_with_Hands_Open_withSkin",
  TALK_3:    "Animation_Talk_with_Left_Hand_Raised_withSkin",
  TALK_4:    "Animation_Talk_with_Right_Hand_Open_withSkin",
};

const talkPool   = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4];
const idlePool   = [ANIM.IDLE_MAIN, ANIM.IDLE_PLAY, ANIM.IDLE_STAG, ANIM.IDLE_RUN];
const alertPool  = [ANIM.ALERT, ANIM.ALERT_R];

// ---------- DOM / state ----------
let mvA, mvB, activeMV, inactiveMV, statusEl;
let state = "boot", micLocked = false, animLock = false, sleepLock = false;
let lastAnimName = null;

const glbCache = new Map(), inflight = new Map();
let audioCtx, analyser, srcNode, amplitudeRAF;
let jawBone=null, fingerBones=[], eyeMeshes=[], boneSearchDone=false, eyeSearchDone=false;
let microIdleRAF=0, microIdleActive=false;
let camDriftRAF=0, camDriftActive=false, camYawBase=0;

window.recognition = null;

// ---------- Smart Cache (3 hours) ----------
const CACHE_KEYS = { CHAT:"bob_chat", MOOD:"bob_mood", ORBIT:"bob_camera_orbit", LASTTS:"bob_last_talk_ts" };
const MAX_CACHE = 10;
const CACHE_TTL_MS = 3*60*60*1000;
const now = ()=>Date.now();

function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    const obj = JSON.parse(raw);
    if(obj && typeof obj==="object" && "ts" in obj){
      if(now()-obj.ts > CACHE_TTL_MS) return fallback;
      return obj.value ?? fallback;
    }
    return fallback;
  }catch{ return fallback; }
}
function saveJSON(key, value){ try{ localStorage.setItem(key, JSON.stringify({ ts: now(), value })); }catch{} }
const getChatHistory = ()=>{ const x=loadJSON(CACHE_KEYS.CHAT,[]); return Array.isArray(x)?x:[]; };
function saveChat(user,bob){ const c=getChatHistory(); c.push({user,bob,ts:now()}); while(c.length>MAX_CACHE) c.shift(); saveJSON(CACHE_KEYS.CHAT,c); }
const rememberMood=(m)=>saveJSON(CACHE_KEYS.MOOD,m);
const recallMood=()=>loadJSON(CACHE_KEYS.MOOD,"calm");
const rememberOrbit=(o)=>saveJSON(CACHE_KEYS.ORBIT,o);
const recallOrbit=()=>loadJSON(CACHE_KEYS.ORBIT,"0deg 75deg 1.8m");
const stampTalk=()=>saveJSON(CACHE_KEYS.LASTTS,now());
const recentTalkWithin=(ms)=> now() - loadJSON(CACHE_KEYS.LASTTS,0) < ms;

// ---------- utils ----------
const setStatus = (m) => (statusEl ??= document.getElementById("status")) && (statusEl.textContent = m);
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
const pick  = (a)  => a[Math.floor(Math.random()*a.length)];
const clamp = (v,a,b)=>Math.min(b,Math.max(a,v));
const lerp  = (a,b,t)=>a+(b-a)*t;
const doubleRaf = async()=>{await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r));};

// ---------- Camera (dolly only + subtle yaw drift) ----------
function setCameraOrbitImmediate(orbitStr){
  if(!activeMV) return;
  activeMV.setAttribute("camera-orbit", orbitStr);
  rememberOrbit(orbitStr);
  const parts = orbitStr.split(" ");
  camYawBase = parseFloat(parts[0]) || 0; // deg
}
async function smoothCameraTransition(targetRadius, duration=1000){
  const mv = activeMV; if(!mv) return;
  const orbit = mv.getAttribute("camera-orbit") || recallOrbit();
  const parts = orbit.split(" ");
  const currentRadius = parseFloat(parts[2]) || 1.8;
  const start = clamp(currentRadius,1.8,4.0);
  const end   = clamp(targetRadius,1.8,4.0);
  const startTime = performance.now();
  const step=(t)=>{
    const k=Math.min((t-startTime)/duration,1);
    const eased = 0.5 - 0.5*Math.cos(Math.PI*k);
    const r = lerp(start,end,eased);
    const out = `${camYawBase.toFixed(2)}deg 75deg ${r.toFixed(2)}m`;
    mv.setAttribute("camera-orbit", out);
    rememberOrbit(out);
    if(k<1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// gentle ±5° yaw drift during idle (no zoom change)
function startCamDrift(){
  if(camDriftRAF) return;
  camDriftActive = true;
  const base = camYawBase;
  const startT = performance.now();
  const tick=(t)=>{
    if(!camDriftActive || state!=="idle"){ camDriftRAF=requestAnimationFrame(tick); return; }
    const elapsed = (t - startT)/1000;
    const yaw = base + Math.sin(elapsed*0.15)*5; // slow ±5°
    const orbit = activeMV?.getAttribute("camera-orbit") || "0deg 75deg 1.8m";
    const parts = orbit.split(" ");
    const radius = parts[2] || "1.8m";
    const out = `${yaw.toFixed(2)}deg 75deg ${radius}`;
    activeMV?.setAttribute("camera-orbit", out);
    rememberOrbit(out);
    camDriftRAF=requestAnimationFrame(tick);
  };
  camDriftRAF=requestAnimationFrame(tick);
}
function stopCamDrift(){ camDriftActive=false; if(camDriftRAF) cancelAnimationFrame(camDriftRAF); camDriftRAF=0; }

// ---------- Loader ----------
async function ensureGlbUrl(name){
  if(glbCache.has(name)) return glbCache.get(name);
  if(inflight.has(name)) return inflight.get(name);
  const p=(async()=>{
    // try requested
    let res = await fetch(`${MODEL_BASE}${name}.glb`, { mode:"cors" });
    if(!res.ok){
      console.warn(`⚠️ Missing model: ${name}, using fallback.`);
      // fallbacks by category
      let fb = ANIM.IDLE_MAIN;
      if(name===ANIM.WAKE_UP || name===ANIM.STAND_UP) fb = ANIM.SHRUG;
      res = await fetch(`${MODEL_BASE}${fb}.glb`, { mode:"cors" });
      if(!res.ok) throw new Error(`Fetch fail ${name} (and fb ${fb})`);
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    glbCache.set(name,url);
    return url;
  })();
  inflight.set(name,p); try{ return await p; } finally { inflight.delete(name); }
}
async function waitForModelLoaded(mv){
  if(mv?.model){ await doubleRaf(); return; }
  await new Promise(res=>{
    const on=()=>{ mv.removeEventListener("load",on); res(); };
    mv.addEventListener("load",on,{once:true});
  });
  await doubleRaf();
}
const getThreeScene = (mv)=> mv?.model?.scene || mv?.scene || null;

// ---------- Bones / Eyes ----------
function fuzzyBoneFind(scene){
  if(!scene) return { jaw:null, fingers:[] };
  let jaw=null; const fingers=[];
  scene.traverse?.(o=>{
    const n=o.name||"";
    if(!jaw && /jaw|chin/i.test(n)) jaw=o;
    if(/finger|hand|wrist|thumb/i.test(n)) fingers.push(o);
  });
  return { jaw, fingers };
}
function fuzzyEyeFind(scene){
  if(!scene) return [];
  const eyes=[]; scene.traverse?.(o=>{
    if(/eye|pupil|iris/i.test(o.name||"") && o.material) eyes.push(o);
  });
  return eyes.slice(0,4);
}
function ensureBindings(){
  const s=getThreeScene(activeMV); if(!s) return;
  if(!boneSearchDone){ const {jaw,fingers}=fuzzyBoneFind(s); jawBone=jaw; fingerBones=fingers.slice(0,6); boneSearchDone=true; }
  if(!eyeSearchDone){ eyeMeshes=fuzzyEyeFind(s); eyeSearchDone=true; }
}
function setEmotionEyesFromText(text){
  ensureBindings(); if(!eyeMeshes.length) return;
  const t=(text||"").toLowerCase(); let color={r:.2,g:.9,b:.2}, intensity=.6, mood="calm";
  if(/angry|mad|rage/.test(t)){ color={r:1,g:.2,b:.1}; intensity=1.2; mood="fired_up"; }
  else if(/sleep|tired|yawn/.test(t)){ color={r:1,g:.7,b:.2}; intensity=.4; mood="sleepy"; }
  else if(/mischief|trick|sneak|prank/.test(t)){ color={r:.95,g:.5,b:1}; intensity=.9; mood="mischief"; }
  for(const m of eyeMeshes){
    if(!m.material) continue;
    if(m.material.emissive) m.material.emissive.setRGB(color.r*intensity,color.g*intensity,color.b*intensity);
    if(m.material.emissiveIntensity!==undefined) m.material.emissiveIntensity = clamp(intensity,.2,2);
  }
  rememberMood(mood);
}

// ---------- Amplitude jaw/fingers ----------
function startAmplitudeDriveFor(audio){
  stopAmplitudeDrive();
  try{
    audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser(); analyser.fftSize=2048;
    const sNode=audioCtx.createMediaElementSource(audio);
    srcNode=sNode; sNode.connect(analyser); analyser.connect(audioCtx.destination);
    const data=new Uint8Array(analyser.fftSize), jS={v:0}, fS={v:0};
    const drive=()=>{
      analyser.getByteTimeDomainData(data);
      let sum=0; for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
      const rms=Math.sqrt(sum/data.length), amp=clamp(rms*6,0,1);
      jS.v=jS.v*.7+amp*.3; fS.v=fS.v*.8+amp*.2; ensureBindings();
      if(jawBone?.rotation) jawBone.rotation.x = -jS.v*.45;
      for(const b of fingerBones) if(b.rotation){
        const bend=fS.v*.25; b.rotation.x=(b.rotation.x||0)-bend*.15; b.rotation.z=(b.rotation.z||0)+bend*.05;
      }
      amplitudeRAF=requestAnimationFrame(drive);
    };
    amplitudeRAF=requestAnimationFrame(drive);
  }catch(e){ console.warn("Audio analysis unavailable:", e); }
}
function stopAmplitudeDrive(){ if(amplitudeRAF) cancelAnimationFrame(amplitudeRAF); amplitudeRAF=0; try{srcNode?.disconnect(); analyser?.disconnect();}catch{} srcNode=null; analyser=null; }

// ---------- Pose capture/apply ----------
function capturePose(mv){ const s=getThreeScene(mv); if(!s) return {}; const p={}; s.traverse?.(o=>{ if(o.isBone) p[o.name]={ r:o.rotation.clone(), p:o.position.clone() }; }); return p; }
function applyPose(mv,p){ const s=getThreeScene(mv); if(!s||!p) return; s.traverse?.(o=>{ const x=p[o.name]; if(x){ o.rotation.copy(x.r); o.position.copy(x.p); } }); }

// ---------- Animation core ----------
async function setAnim(name,{minHoldMs=700,blendMs=300}={}){
  if(animLock) return; animLock=true;
  try{
    const pose=capturePose(activeMV);
    activeMV?.classList.remove("active");
    await sleep(blendMs);
    const url=await ensureGlbUrl(name);
    inactiveMV.setAttribute("src",url);
    await waitForModelLoaded(inactiveMV);
    applyPose(inactiveMV,pose);
    try{ inactiveMV.currentTime=0; await inactiveMV.play(); }catch{}
    inactiveMV.classList.add("active");
    await sleep(blendMs);
    [activeMV,inactiveMV]=[inactiveMV,activeMV];
    boneSearchDone=false; eyeSearchDone=false; lastAnimName=name;
    if(minHoldMs>0) await sleep(minHoldMs);
  }finally{ animLock=false; }
}

// ---------- Micro idle ----------
function startMicroIdle(){
  if(microIdleRAF) return; microIdleActive=true; const ph=Math.random()*Math.PI*2;
  const tick=()=>{
    if(!microIdleActive || state!=="idle"){ microIdleRAF=requestAnimationFrame(tick); return; }
    ensureBindings(); const s=getThreeScene(activeMV);
    if(s){
      const head=jawBone?.parent; const k=Math.sin(performance.now()/1000*.6+ph)*.03;
      if(head?.rotation){ head.rotation.y=lerp(head.rotation.y,k,.05); head.rotation.x=lerp(head.rotation.x,-k*.5,.05); }
    }
    microIdleRAF=requestAnimationFrame(tick);
  };
  microIdleRAF=requestAnimationFrame(tick);
}
function stopMicroIdle(){ microIdleActive=false; if(microIdleRAF) cancelAnimationFrame(microIdleRAF); microIdleRAF=0; }

// ---------- Speaking (chat) ----------
async function speakAndAnimate(userText){
  if(!userText) return;
  try{
    state="talking"; stopMicroIdle(); stopCamDrift(); setStatus("💬 Thinking...");
    const history=getChatHistory(); const mood=recallMood();
    const chat=await fetch(`${WORKER_URL}/`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:userText,history,mood})});
    const data=await chat.json();
    const reply=data.reply || "Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:", reply);
    setEmotionEyesFromText(reply);

    // TTS (Onyx)
    let buf=null;
    for(let i=0;i<2;i++){
      try{
        const r=await fetch(`${WORKER_URL}/tts`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:reply,voice:"onyx"})});
        if(!r.ok){ await r.text(); continue; }
        buf=await r.arrayBuffer(); break;
      }catch{}
    }
    if(!buf){ setStatus("⚠️ Couldn't speak"); state="idle"; startMicroIdle(); startCamDrift(); return; }

    const audio=new Audio(URL.createObjectURL(new Blob([buf],{type:"audio/mpeg"})));
    audio.playbackRate=0.9; audio.preservesPitch=false;

    micLocked=true; if(window.recognition) try{ window.recognition.stop(); }catch{}
    audio.addEventListener("play", async ()=>{
      await setAnim(pick(talkPool), { minHoldMs:0, blendMs:250 });
      startAmplitudeDriveFor(audio);
    }, { once:true });

    await audio.play().catch(console.warn);
    audio.onended = async ()=>{
      stopAmplitudeDrive(); stampTalk(); saveChat(userText, reply);
      state="idle"; setStatus("👂 Listening...");
      await setAnim(pick([ANIM.IDLE_MAIN, ANIM.AGREE, ANIM.SHRUG]), { minHoldMs:600, blendMs:300 });
      micLocked=false; if(window.recognition) try{ window.recognition.start(); }catch{}
      startMicroIdle(); startCamDrift();
    };
  }catch(e){
    console.error("Speech error:", e);
    stopAmplitudeDrive(); state="idle"; micLocked=false; startMicroIdle(); startCamDrift();
  }
}

// ---------- Spoken Skits (no chat) ----------
const SKITS = {
  [ANIM.IDLE_PLAY]: [
    "Gotta keep these old bones limber somehow.",
    "Heh—watch this trick I learned in the afterlife."
  ],
  [ANIM.IDLE_STAG]: [
    "Still learnin’ to walk without the muscles, pardner.",
    "Careful now—these bones got a mind of their own."
  ],
  [ANIM.IDLE_RUN]: [
    "Catch me if ya can—hope I don’t fall apart!",
    "Wind in the ribs! That’s the good stuff."
  ],
  [ANIM.SHRUG]: [
    "Beats me, partner.",
    "Well, ain’t that a pickle."
  ],
  [ANIM.WAKE_UP]: [
    "Whew… even ghosts need shuteye.",
    "Whoo-wee… dreamt of tumbleweeds and chili."
  ],
  [ANIM.ALERT]: [
    "Huh? Thought I heard spurs jinglin’."
  ],
  [ANIM.ALERT_R]: [
    "Whoa there—somethin’ moved."
  ]
};
async function saySkitFor(animKey){
  const lines = SKITS[animKey]; if(!lines || !lines.length) return;
  // Don’t spam skits if just talked
  if(recentTalkWithin(7000)) return;

  const line = pick(lines);
  try{
    // mic lock and direct TTS (skip chat)
    micLocked=true; if(window.recognition) try{ window.recognition.stop(); }catch{}
    const r = await fetch(`${WORKER_URL}/tts`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ text: line, voice: "onyx" })
    });
    if(!r.ok){ await r.text(); return; }
    const buf = await r.arrayBuffer();
    const audio = new Audio(URL.createObjectURL(new Blob([buf],{type:"audio/mpeg"})));
    audio.playbackRate=0.95; audio.preservesPitch=false;
    audio.addEventListener("play",()=> startAmplitudeDriveFor(audio), { once:true });
    await audio.play().catch(()=>{});
    audio.onended = ()=>{ stopAmplitudeDrive(); micLocked=false; if(window.recognition) try{window.recognition.start();}catch{}; };
  }catch{
    micLocked=false; if(window.recognition) try{window.recognition.start();}catch{}
  }
}

// ---------- Sleep / Wake ----------
let lastActivity = now();
const bumpActivity = ()=>{ lastActivity = now(); };

async function enterSleep(){
  if(state!=="idle" || sleepLock) return;
  sleepLock=true; state="sleeping"; stopMicroIdle(); stopCamDrift();
  setStatus("😴 Nodding off…");
  await smoothCameraTransition(3.2, 1200);
  await setAnim(ANIM.SLEEP, { minHoldMs:1800, blendMs:600 });
}
async function standUpSequence(){
  await smoothCameraTransition(1.8, 1000);
  await setAnim(ANIM.WAKE_UP, { minHoldMs:400, blendMs:700 });
  await setAnim(ANIM.STAND_UP,{ minHoldMs:500, blendMs:600 });
  await setAnim(ANIM.IDLE_MAIN,{ minHoldMs:800, blendMs:500 });
  startMicroIdle(); startCamDrift();
  state="idle"; sleepLock=false; setStatus("👂 Listening...");
  saySkitFor(ANIM.WAKE_UP);
}

// pointer wake fallback
document.addEventListener("pointerdown", ()=>{
  bumpActivity();
  if(state==="sleeping"){ state="waking"; standUpSequence(); }
},{ passive:true });

// ---------- Idle variety scheduler ----------
function scheduleIdleVariety(){
  const nextIn = 15000 + Math.random()*10000; // 15–25s
  setTimeout(async ()=>{
    if(state!=="idle") { scheduleIdleVariety(); return; }
    bumpActivity();

    // Weighted picks
    const r = Math.random();
    let anim = ANIM.IDLE_MAIN;
    if(r < 0.05) anim = pick(alertPool);
    else if(r < 0.20) anim = ANIM.IDLE_PLAY;
    else if(r < 0.40) anim = pick([ANIM.IDLE_STAG, ANIM.IDLE_RUN, ANIM.WALK]);
    else anim = ANIM.IDLE_MAIN;

    await setAnim(anim, { minHoldMs: 600, blendMs: 300 });
    saySkitFor(anim);

    // ~10% chance to drift into sleep after a busy idle
    if([ANIM.IDLE_STAG,ANIM.IDLE_RUN,ANIM.IDLE_PLAY,ANIM.WALK].includes(anim) && Math.random()<0.10){
      await enterSleep();
    }

    scheduleIdleVariety();
  }, nextIn);
}

// ---------- Microphone ----------
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if(window.SpeechRecognition){
  const rec = new SpeechRecognition();
  rec.continuous=true; rec.interimResults=false; rec.lang="en-US";
  window.recognition = rec;

  rec.onresult = async (e)=>{
    const t=e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    if(!t) return;
    console.log("🎤 Heard:", t);

    if(state==="sleeping" && /hey\s*bob/.test(t)){ state="waking"; await standUpSequence(); return; }
    bumpActivity();
    await speakAndAnimate(t);
  };
  rec.onerror = (e)=>console.warn("Speech recognition error:", e.error);
  rec.onend   = ()=>{ if(!micLocked && state!=="sleeping") rec.start(); };
  window.addEventListener("click",()=>{ try{ rec.start(); setStatus("👂 Listening (mic on)..."); }catch{} }, { once:true });
}else{
  console.warn("SpeechRecognition not supported.");
}

// ---------- Warmup / Boot ----------
async function warmup(){
  const warm = new Set([ANIM.IDLE_MAIN, ANIM.SHRUG, ANIM.SLEEP, ANIM.WAKE_UP, ANIM.STAND_UP, ...talkPool, ...idlePool, ...alertPool]);
  let d=100; for(const n of warm){ setTimeout(()=>ensureGlbUrl(n).catch(()=>{}), d); d+=100; }
}
async function boot(){
  try{
    console.log("🟢 Booting Bob...");
    statusEl = document.getElementById("status");
    mvA = document.getElementById("mvA"); mvB = document.getElementById("mvB");
    if(!mvA||!mvB){ setStatus("Error: model-viewer not found"); return; }

    activeMV=mvA; inactiveMV=mvB; activeMV.classList.add("active");

    // Initialize camera immediately to avoid any warmup snap; restore last orbit
    setCameraOrbitImmediate(recallOrbit());
    activeMV.setAttribute("camera-target","0m 1.2m 0m");

    setStatus("Warming up…"); await warmup(); console.log("✅ Warmup complete");

    await setAnim(ANIM.IDLE_MAIN, { minHoldMs:800, blendMs:300 });
    state="idle"; lastActivity=now(); startMicroIdle(); startCamDrift();

    // ensure never closer than 1.8m
    const orbit=activeMV.getAttribute("camera-orbit")||"0deg 75deg 1.8m";
    const parts=orbit.split(" "); const r=parseFloat(parts[2])||1.8;
    if(r<1.8) setCameraOrbitImmediate("0deg 75deg 1.8m");

    scheduleIdleVariety();

    document.addEventListener("keydown",(e)=>{ if(e.key.toLowerCase()==="p") speakAndAnimate("Howdy partner! Ready to rustle up some mischief?"); });

    console.log("🎉 Bob ready!");
  }catch(e){
    console.error("Boot error:", e);
    setStatus("⚠️ Failed to load Bob");
  }
}

window.addEventListener("DOMContentLoaded", ()=>{ console.log("📦 DOMContentLoaded — launching boot()"); boot(); });

// Public helpers (debug)
window.Bob = { setAnim, speak: speakAndAnimate, state: ()=>state };
