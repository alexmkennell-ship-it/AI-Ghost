// bob.js — Expressive Build 2.2
// Full version: smooth fades, jaw/fingers, eyes, micro-idle,
// deep “copper” voice, mic-lock, and TTS-retry fallback.

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const MODEL_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

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

const idlePool = [ANIM.IDLE_MAIN];
const talkPool = [ANIM.TALK_1, ANIM.TALK_2, ANIM.TALK_3, ANIM.TALK_4];

let mvA, mvB, activeMV, inactiveMV, statusEl;
let state = "boot";
const glbCache = new Map();
const inflight = new Map();
let micLocked = false;

window.recognition = null;

// ---------------- utils ----------------
const setStatus = (m) => (statusEl ??= document.getElementById("status")) && (statusEl.textContent = m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const doubleRaf = async () => { await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r)); };

// ---------------- GLB loader ----------------
async function ensureGlbUrl(name) {
  if (glbCache.has(name)) return glbCache.get(name);
  if (inflight.has(name)) return inflight.get(name);
  const p = (async () => {
    const res = await fetch(`${MODEL_BASE}${name}.glb`, { mode: "cors" });
    if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    glbCache.set(name, url);
    return url;
  })();
  inflight.set(name, p);
  try { return await p; } finally { inflight.delete(name); }
}

async function waitForModelLoaded(mv){
  if(mv?.model){await doubleRaf();return;}
  await new Promise(res=>{const on=()=>{mv.removeEventListener("load",on);res();};mv.addEventListener("load",on,{once:true});});
  await doubleRaf();
}
function getThreeScene(mv){return mv?.model?.scene||mv?.scene||null;}

// ---------------- expressive bindings ----------------
let audioCtx, analyser, srcNode, amplitudeRAF;
let jawBone=null, fingerBones=[], eyeMeshes=[];
let boneSearchDone=false, eyeSearchDone=false;
let microIdleRAF=0, microIdleActive=false, microIdleTimer=0;

function fuzzyBoneFind(scene){
  if(!scene)return{jaw:null,fingers:[]};
  let jaw=null;const fingers=[];const jr=/jaw|chin/i, fr=/finger|index|middle|ring|pinky|thumb/i, hr=/hand|wrist/i;
  scene.traverse?.(o=>{const n=o.name||"";if(!jaw&&jr.test(n))jaw=o;if(fr.test(n)||hr.test(n))fingers.push(o);});
  return{jaw,fingers};
}
function fuzzyEyeFind(scene){
  if(!scene)return[];const eyes=[],er=/eye|pupil|iris/i;
  scene.traverse?.(o=>{if(er.test(o.name||"")&&o.material)eyes.push(o);});
  return eyes.slice(0,4);
}
function ensureBindings(){
  const s=getThreeScene(activeMV); if(!s)return;
  if(!boneSearchDone){const{jaw,fingers}=fuzzyBoneFind(s);jawBone=jaw;fingerBones=fingers.slice(0,6);boneSearchDone=true;}
  if(!eyeSearchDone){eyeMeshes=fuzzyEyeFind(s);eyeSearchDone=true;}
}

// ---------------- eyes ----------------
function setEmotionEyesFromText(t){
  ensureBindings(); if(!eyeMeshes.length)return;
  const x=(t||"").toLowerCase(); let c={r:.2,g:.9,b:.2},i=.6;
  if(/angry|mad|rage|stomp/.test(x)){c={r:1,g:.2,b:.1};i=1.2;}
  else if(/sleep|tired|yawn/.test(x)){c={r:1,g:.7,b:.2};i=.4;}
  else if(/mischief|sneak|trick/.test(x)){c={r:.95,g:.5,b:1};i=.9;}
  for(const m of eyeMeshes){
    if(!m.material)continue;
    if(m.material.emissive)m.material.emissive.setRGB(c.r*i,c.g*i,c.b*i);
    if(m.material.emissiveIntensity!==undefined)m.material.emissiveIntensity=clamp(i,.2,2);
  }
}

// ---------------- micro idle ----------------
function startMicroIdle(){
  if(microIdleRAF)return;microIdleActive=true;let p=Math.random()*Math.PI*2;
  const tick=()=>{if(!microIdleActive||state!=="idle"){microIdleRAF=requestAnimationFrame(tick);return;}
    ensureBindings();const s=getThreeScene(activeMV);
    if(s){const h=jawBone?.parent;if(h&&h.rotation){const k=Math.sin(performance.now()/1000*.6+p)*.03;
      h.rotation.y=lerp(h.rotation.y,k,.05);h.rotation.x=lerp(h.rotation.x,-k*.5,.05);}
      for(const b of fingerBones)if(b.rotation)b.rotation.z=lerp(b.rotation.z,Math.sin(performance.now()/1000*.8+p)*.02,.08);}
    if(!microIdleTimer||performance.now()>microIdleTimer){microIdleTimer=performance.now()+1e4+Math.random()*1e4;if(state==="idle")setAnim(ANIM.IDLE_MAIN,{minHoldMs:600,blendMs:500});}
    microIdleRAF=requestAnimationFrame(tick);};
  microIdleRAF=requestAnimationFrame(tick);
}
function stopMicroIdle(){microIdleActive=false;if(microIdleRAF)cancelAnimationFrame(microIdleRAF);microIdleRAF=0;}

// ---------------- amplitude drive ----------------
function startAmplitudeDriveFor(audio){
  stopAmplitudeDrive();
  try{
    audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser();analyser.fftSize=2048;
    const sNode=audioCtx.createMediaElementSource(audio);srcNode=sNode;
    sNode.connect(analyser);analyser.connect(audioCtx.destination);
    const data=new Uint8Array(analyser.fftSize),jS={v:0},fS={v:0};
    const drive=()=>{analyser.getByteTimeDomainData(data);let sum=0;
      for(let i=0;i<data.length;i++){const v=(data[i]-128)/128;sum+=v*v;}
      const rms=Math.sqrt(sum/data.length),amp=clamp(rms*6,0,1);
      jS.v=jS.v*.7+amp*.3;fS.v=fS.v*.8+amp*.2;ensureBindings();
      if(jawBone?.rotation)jawBone.rotation.x=-jS.v*.45;
      for(const b of fingerBones)if(b.rotation){const bend=fS.v*.25;b.rotation.x=(b.rotation.x||0)-bend*.15;b.rotation.z=(b.rotation.z||0)+bend*.05;}
      amplitudeRAF=requestAnimationFrame(drive);};
    amplitudeRAF=requestAnimationFrame(drive);
  }catch(e){console.warn("Audio analysis unavailable:",e);}
}
function stopAmplitudeDrive(){if(amplitudeRAF)cancelAnimationFrame(amplitudeRAF);
  amplitudeRAF=0;try{srcNode?.disconnect();analyser?.disconnect();}catch{}srcNode=null;analyser=null;}

// ---------------- animation ----------------
async function setAnim(name,{minHoldMs=800,blendMs=600}={}){
  if(!inactiveMV||!activeMV)return;
  activeMV.classList.remove("active");await sleep(blendMs);
  const url=await ensureGlbUrl(name);
  inactiveMV.setAttribute("src",url);await waitForModelLoaded(inactiveMV);
  try{inactiveMV.currentTime=0;await inactiveMV.play();}catch{}
  inactiveMV.classList.add("active");await sleep(blendMs);
  [activeMV,inactiveMV]=[inactiveMV,activeMV];boneSearchDone=false;eyeSearchDone=false;
  if(minHoldMs>0)await sleep(minHoldMs);
}
async function warmup(){const w=new Set([ANIM.IDLE_MAIN,ANIM.SHRUG,ANIM.SLEEP,...talkPool]);let d=100;for(const n of w){setTimeout(()=>ensureGlbUrl(n).catch(()=>{}),d);d+=100;}}
let idleSwapTimer=null;function scheduleIdleSwap(){clearTimeout(idleSwapTimer);
  idleSwapTimer=setTimeout(async()=>{if(state==="idle")await setAnim(ANIM.IDLE_MAIN,{minHoldMs:1e3,blendMs:500});scheduleIdleSwap();},12000+Math.random()*5e3);}

// ---------------- speaking ----------------
let abortSpeech=null;
async function speakAndAnimate(userText){
  if(!userText)return;
  try{
    state="talking";stopMicroIdle();setStatus("💬 Thinking...");
    const chatResp=await fetch(`${WORKER_URL}/`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:userText})});
    const data=await chatResp.json();const replyText=data.reply||"Well shoot, reckon I'm tongue-tied, partner.";console.log("🤖 Bob says:",replyText);
    setEmotionEyesFromText(replyText);

    const ac=new AbortController();abortSpeech=()=>ac.abort();

    // --- retry & fallback TTS ---
    const maxRetries=2;let ttsResp,ttsBuffer;
    for(let attempt=0;attempt<=maxRetries;attempt++){
      try{
        ttsResp=await fetch(`${WORKER_URL}/tts`,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({text:replyText,voice:"onyx"}),
          signal:ac.signal
        });
        if(!ttsResp.ok){
          const errTxt=await ttsResp.text();
          console.warn(`TTS attempt ${attempt} failed:`,ttsResp.status,errTxt);
          if(attempt===maxRetries)throw new Error(`TTS failed ${ttsResp.status}`);
          continue;
        }
        ttsBuffer=await ttsResp.arrayBuffer();break;
      }catch(err){
        console.warn("TTS error:",err);
        if(attempt===maxRetries){setStatus("⚠️ Couldn't speak — server error");state="idle";startMicroIdle();return;}
      }
    }

    const blob=new Blob([ttsBuffer],{type:"audio/mpeg"});
    const url=URL.createObjectURL(blob);
    const audio=new Audio(url);
    audio.playbackRate=0.9;
    audio.preservesPitch = false; // drop actual pitch for gravelly drawl

    // lock mic
    micLocked=true;if(window.recognition)try{window.recognition.stop();}catch{}

    audio.addEventListener("play",async()=>{
      await setAnim(pick(talkPool),{minHoldMs:0,blendMs:350});
      const loop=()=>{if(state!=="talking"||audio.paused||audio.ended)return;
        setTimeout(()=>{if(state==="talking"&&!audio.ended){setAnim(pick(talkPool),{minHoldMs:0,blendMs:300});loop();}},2e3+Math.random()*500);};
      loop();startAmplitudeDriveFor(audio);
    },{once:true});

    await audio.play().catch(console.warn);

    audio.onended=async()=>{
      stopAmplitudeDrive();URL.revokeObjectURL(url);
      state="idle";setStatus("👂 Listening...");
      await setAnim(ANIM.IDLE_MAIN,{minHoldMs:600,blendMs:500});
      micLocked=false;if(window.recognition)try{window.recognition.start();}catch{}
      startMicroIdle();
    };
  }catch(e){console.error("Speech error:",e);stopAmplitudeDrive();setStatus("⚠️ Speech error — see console");state="idle";micLocked=false;startMicroIdle();}
}

// ---------------- idle/sleep ----------------
let lastActivity=Date.now();function bumpActivity(){lastActivity=Date.now();}
setInterval(async()=>{const idleMs=Date.now()-lastActivity;
  if(state==="idle"&&idleMs>45000){state="sleeping";stopMicroIdle();setStatus("😴 Sleeping...");await setAnim(ANIM.SLEEP,{minHoldMs:1500,blendMs:600});}},1e3);
document.addEventListener("pointerdown",()=>{bumpActivity();if(state==="sleeping"){state="idle";setStatus("👂 Listening...");setAnim(ANIM.IDLE_MAIN,{minHoldMs:800,blendMs:500});startMicroIdle();}},{passive:true});

// ---------------- microphone ----------------
window.SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(window.SpeechRecognition){
  const rec=new SpeechRecognition();rec.continuous=true;rec.interimResults=false;rec.lang="en-US";window.recognition=rec;
  rec.onresult=async e=>{const t=e.results[e.results.length-1][0].transcript.trim();if(t.length>0){console.log("🎤 Heard:",t);await speakAndAnimate(t);}};
  rec.onerror=e=>console.warn("Speech recognition error:",e.error);
  rec.onend=()=>{if(!micLocked&&state==="idle")rec.start();};
  window.addEventListener("click",()=>{try{rec.start();setStatus("👂 Listening (mic on)...");}catch(err){console.warn("Mic start error:",err);}}, {once:true});
}else console.warn("SpeechRecognition not supported.");
// ---------------- boot ----------------
async function boot(){
  try{
    console.log("🟢 Booting Bob...");
    statusEl=document.getElementById("status");
    mvA=document.getElementById("mvA");mvB=document.getElementById("mvB");
    if(!mvA||!mvB){setStatus("Error: model-viewer not found");console.error("❌ Missing model-viewer elements!");return;}
    activeMV=mvA;inactiveMV=mvB;activeMV.classList.add("active");inactiveMV.classList.remove("active");
    setStatus("Warming up…");await warmup();console.log("✅ Warmup complete");
    await setAnim(ANIM.IDLE_MAIN,{minHoldMs:800,blendMs:500});
    state="idle";setStatus("👂 Listening...");scheduleIdleSwap();startMicroIdle();
    document.addEventListener("keydown",e=>{if(e.key.toLowerCase()==="p"){speakAndAnimate("Howdy partner! Ready to rustle up some mischief?");}});
    console.log("🎉 Bob ready!");
  }catch(e){console.error("Boot error:",e);setStatus("⚠️ Failed to load Bob");}
}
window.addEventListener("DOMContentLoaded",()=>{console.log("📦 DOMContentLoaded — launching boot()");boot();});
window.Bob={setAnim,speak:speakAndAnimate,state:()=>state};
