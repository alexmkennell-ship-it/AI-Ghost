// bob.js — Expressive Build 2.5
// Sleep zoom-out, wake stand-up, smooth pose carryover & idle randomization

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
const idleVariety=[ANIM.IDLE_MAIN,ANIM.SHRUG,ANIM.YAWN];
const talkPool=[ANIM.TALK_1,ANIM.TALK_2,ANIM.TALK_3,ANIM.TALK_4];

let mvA,mvB,activeMV,inactiveMV,statusEl;
let state="boot",micLocked=false,animLock=false,sleepLock=false;
const glbCache=new Map(),inflight=new Map();
window.recognition=null;

// ---------- utils ----------
const setStatus=(m)=>(statusEl??=document.getElementById("status"))&&(statusEl.textContent=m);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const pick=(a)=>a[Math.floor(Math.random()*a.length)];
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const doubleRaf=async()=>{await new Promise(r=>requestAnimationFrame(r));await new Promise(r=>requestAnimationFrame(r));};
function setCameraOrbit(orbit){if(activeMV)activeMV.setAttribute("camera-orbit",orbit);}

// ---------- model loader ----------
async function ensureGlbUrl(name){
  if(glbCache.has(name))return glbCache.get(name);
  if(inflight.has(name))return inflight.get(name);
  const p=(async()=>{
    const res=await fetch(`${MODEL_BASE}${name}.glb`,{mode:"cors"});
    if(!res.ok)throw new Error(`Fetch ${name} failed`);
    const blob=await res.blob();const url=URL.createObjectURL(blob);
    glbCache.set(name,url);return url;
  })();
  inflight.set(name,p);
  try{return await p;}finally{inflight.delete(name);}
}
async function waitForModelLoaded(mv){
  if(mv?.model){await doubleRaf();return;}
  await new Promise(res=>{
    const on=()=>{mv.removeEventListener("load",on);res();};
    mv.addEventListener("load",on,{once:true});
  });
  await doubleRaf();
}
function getThreeScene(mv){return mv?.model?.scene||mv?.scene||null;}

// ---------- bones / eyes ----------
let jawBone=null,fingerBones=[],eyeMeshes=[],boneSearchDone=false,eyeSearchDone=false;
function fuzzyBoneFind(scene){
  if(!scene)return{jaw:null,fingers:[]};
  let jaw=null;const fingers=[];
  scene.traverse?.(o=>{
    const n=o.name||"";
    if(!jaw&&/jaw|chin/i.test(n))jaw=o;
    if(/finger|hand|wrist|thumb/i.test(n))fingers.push(o);
  });
  return{jaw,fingers};
}
function fuzzyEyeFind(scene){
  if(!scene)return[];
  const eyes=[];scene.traverse?.(o=>{
    if(/eye|pupil|iris/i.test(o.name||"")&&o.material)eyes.push(o);
  });
  return eyes.slice(0,4);
}
function ensureBindings(){
  const s=getThreeScene(activeMV);if(!s)return;
  if(!boneSearchDone){const{jaw,fingers}=fuzzyBoneFind(s);jawBone=jaw;fingerBones=fingers.slice(0,6);boneSearchDone=true;}
  if(!eyeSearchDone){eyeMeshes=fuzzyEyeFind(s);eyeSearchDone=true;}
}
function setEmotionEyesFromText(t){
  ensureBindings();if(!eyeMeshes.length)return;
  const x=(t||"").toLowerCase();let c={r:.2,g:.9,b:.2},i=.6;
  if(/angry|mad|rage/.test(x)){c={r:1,g:.2,b:.1};i=1.2;}
  else if(/sleep|tired|yawn/.test(x)){c={r:1,g:.7,b:.2};i=.4;}
  else if(/mischief|trick/.test(x)){c={r:.95,g:.5,b:1};i=.9;}
  for(const m of eyeMeshes){
    if(!m.material)continue;
    if(m.material.emissive)m.material.emissive.setRGB(c.r*i,c.g*i,c.b*i);
    if(m.material.emissiveIntensity!==undefined)m.material.emissiveIntensity=clamp(i,.2,2);
  }
}

// ---------- amplitude ----------
let audioCtx,analyser,srcNode,amplitudeRAF;
function startAmplitudeDriveFor(audio){
  stopAmplitudeDrive();
  try{
    audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser();analyser.fftSize=2048;
    const sNode=audioCtx.createMediaElementSource(audio);
    srcNode=sNode;sNode.connect(analyser);analyser.connect(audioCtx.destination);
    const data=new Uint8Array(analyser.fftSize),jS={v:0},fS={v:0};
    const drive=()=>{
      analyser.getByteTimeDomainData(data);
      let sum=0;for(let i=0;i<data.length;i++){const v=(data[i]-128)/128;sum+=v*v;}
      const rms=Math.sqrt(sum/data.length),amp=clamp(rms*6,0,1);
      jS.v=jS.v*.7+amp*.3;fS.v=fS.v*.8+amp*.2;ensureBindings();
      if(jawBone?.rotation)jawBone.rotation.x=-jS.v*.45;
      for(const b of fingerBones)if(b.rotation){
        const bend=fS.v*.25;
        b.rotation.x=(b.rotation.x||0)-bend*.15;
        b.rotation.z=(b.rotation.z||0)+bend*.05;
      }
      amplitudeRAF=requestAnimationFrame(drive);
    };
    amplitudeRAF=requestAnimationFrame(drive);
  }catch(e){console.warn("Audio analysis unavailable:",e);}
}
function stopAmplitudeDrive(){if(amplitudeRAF)cancelAnimationFrame(amplitudeRAF);amplitudeRAF=0;try{srcNode?.disconnect();analyser?.disconnect();}catch{}srcNode=null;analyser=null;}

// ---------- pose ----------
function capturePose(mv){const s=getThreeScene(mv);if(!s)return{};const p={};s.traverse?.(o=>{if(o.isBone)p[o.name]={r:o.rotation.clone(),pos:o.position.clone()};});return p;}
function applyPose(mv,p){const s=getThreeScene(mv);if(!s)return;s.traverse?.(o=>{const t=p[o.name];if(t){o.rotation.copy(t.r);o.position.copy(t.pos);}});}

// ---------- animation core ----------
async function setAnim(name,{minHoldMs=800,blendMs=300}={}){
  if(animLock)return;
  animLock=true;
  try{
    const pose=capturePose(activeMV);
    activeMV.classList.remove("active");
    await sleep(blendMs);
    const url=await ensureGlbUrl(name);
    inactiveMV.setAttribute("src",url);
    await waitForModelLoaded(inactiveMV);
    applyPose(inactiveMV,pose);
    try{inactiveMV.currentTime=0;await inactiveMV.play();}catch{}
    inactiveMV.classList.add("active");
    await sleep(blendMs);
    [activeMV,inactiveMV]=[inactiveMV,activeMV];
    boneSearchDone=false;eyeSearchDone=false;
    if(minHoldMs>0)await sleep(minHoldMs);
  }finally{animLock=false;}
}

// ---------- micro-idle ----------
let microIdleRAF=0,microIdleActive=false;
function startMicroIdle(){
  if(microIdleRAF)return;microIdleActive=true;const p=Math.random()*Math.PI*2;
  const tick=()=>{
    if(!microIdleActive||state!=="idle"){microIdleRAF=requestAnimationFrame(tick);return;}
    ensureBindings();const s=getThreeScene(activeMV);
    if(s){const h=jawBone?.parent;
      const k=Math.sin(performance.now()/1000*.6+p)*.03;
      if(h&&h.rotation){h.rotation.y=lerp(h.rotation.y,k,.05);h.rotation.x=lerp(h.rotation.x,-k*.5,.05);}
    }
    microIdleRAF=requestAnimationFrame(tick);
  };
  microIdleRAF=requestAnimationFrame(tick);
}
function stopMicroIdle(){microIdleActive=false;if(microIdleRAF)cancelAnimationFrame(microIdleRAF);microIdleRAF=0;}

// ---------- speaking ----------
async function speakAndAnimate(userText){
  if(!userText)return;
  try{
    state="talking";stopMicroIdle();setStatus("💬 Thinking...");
    const chat=await fetch(`${WORKER_URL}/`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:userText})});
    const data=await chat.json();const reply=data.reply||"Well shoot, reckon I'm tongue-tied, partner.";
    console.log("🤖 Bob says:",reply);setEmotionEyesFromText(reply);
    const ac=new AbortController();let buf;
    for(let i=0;i<2;i++){try{
      const r=await fetch(`${WORKER_URL}/tts`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:reply,voice:"onyx"}),signal:ac.signal});
      if(!r.ok){await r.text();continue;}buf=await r.arrayBuffer();break;
    }catch{}}
    if(!buf){setStatus("⚠️ TTS error");state="idle";startMicroIdle();return;}
    const audio=new Audio(URL.createObjectURL(new Blob([buf],{type:"audio/mpeg"})));
    audio.playbackRate=0.9;audio.preservesPitch=false;
    micLocked=true;if(window.recognition)try{window.recognition.stop();}catch{}
    audio.addEventListener("play",async()=>{await setAnim(pick(talkPool),{minHoldMs:0,blendMs:200});startAmplitudeDriveFor(audio);});
    await audio.play().catch(console.warn);
    audio.onended=async()=>{
      stopAmplitudeDrive();state="idle";setStatus("👂 Listening...");
      await setAnim(pick(idleVariety),{minHoldMs:600,blendMs:300});
      micLocked=false;if(window.recognition)try{window.recognition.start();}catch{}startMicroIdle();
    };
  }catch(e){console.error(e);state="idle";micLocked=false;startMicroIdle();}
}

// ---------- sleep logic ----------
let lastActivity=Date.now();
function bumpActivity(){lastActivity=Date.now();}
async function maybeSleep(){
  if(state!=="idle"||sleepLock)return;
  if(Math.random()<0.25){
    sleepLock=true;state="sleeping";stopMicroIdle();
    setStatus("😴 Nodding off...");setCameraOrbit("0deg 90deg 3m");
    await setAnim(ANIM.SLEEP,{minHoldMs:1800,blendMs:600});
    sleepLock=false;
  }
}
setInterval(async()=>{if(state==="idle"&&Date.now()-lastActivity>40000)await maybeSleep();},1000);

// ---------- wake voice + click ----------
document.addEventListener("pointerdown",()=>{bumpActivity();
  if(state==="sleeping"){state="idle";setStatus("👂 Listening...");
    setCameraOrbit("0deg 75deg 1.8m");
    (async()=>{await setAnim(ANIM.SHRUG,{minHoldMs:500,blendMs:700});
      await setAnim(ANIM.IDLE_MAIN,{minHoldMs:800,blendMs:600});startMicroIdle();})();}},
  {passive:true});

// ---------- microphone ----------
window.SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(window.SpeechRecognition){
  const rec=new SpeechRecognition();rec.continuous=true;rec.interimResults=false;rec.lang="en-US";
  window.recognition=rec;
  rec.onresult=async e=>{
    const t=e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    if(!t)return;
    console.log("🎤 Heard:",t);
    if(state==="sleeping"&&/hey\s*bob/.test(t)){
      console.log("👂 Wake phrase detected");
      state="idle";setStatus("👂 Listening...");
      setCameraOrbit("0deg 75deg 1.8m");
      await setAnim(ANIM.SHRUG,{minHoldMs:500,blendMs:700});
      await setAnim(ANIM.IDLE_MAIN,{minHoldMs:800,blendMs:600});
      startMicroIdle();return;
    }
    await speakAndAnimate(t);
  };
  rec.onerror=e=>console.warn("Speech recognition error:",e.error);
  rec.onend=()=>{if(!micLocked)rec.start();};
  window.addEventListener("click",()=>{try{rec.start();setStatus("👂 Listening (mic on)...");}catch{}},{once:true});
}else console.warn("SpeechRecognition not supported.");

// ---------- boot ----------
async function boot(){
  try{
    console.log("🟢 Booting Bob...");
    statusEl=document.getElementById("status");
    mvA=document.getElementById("mvA");mvB=document.getElementById("mvB");
    if(!mvA||!mvB){setStatus("Error: model-viewer not found");return;}
    activeMV=mvA;inactiveMV=mvB;
    activeMV.classList.add("active");
    setStatus("Warming up…");await warmup();
    console.log("✅ Warmup complete");
    await setAnim(ANIM.IDLE_MAIN,{minHoldMs:800,blendMs:300});
    state="idle";setStatus("👂 Listening...");
    startMicroIdle();
    document.addEventListener("keydown",e=>{
      if(e.key.toLowerCase()==="p")speakAndAnimate("Howdy partner! Ready to rustle up some mischief?");
    });
    console.log("🎉 Bob ready!");
  }catch(e){console.error("Boot error:",e);setStatus("⚠️ Failed to load Bob");}
}
async function warmup(){const w=new Set([ANIM.IDLE_MAIN,ANIM.SHRUG,ANIM.SLEEP,...talkPool]);let d=100;for(const n of w){setTimeout(()=>ensureGlbUrl(n).catch(()=>{}),d);d+=100;}}
window.addEventListener("DOMContentLoaded",()=>{console.log("📦 DOMContentLoaded — launching boot()");boot();});
window.Bob={setAnim,speak:speakAndAnimate,state:()=>state};
