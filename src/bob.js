// Bob v10.3 — Storyteller Edition (smooth blends, voice pitch/speed, gestures, listening cue)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

console.log("📖 Bob v10.3 — Storyteller online");

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const DEFAULT_IDLE = "Neutral Idle";

// voice tuning for cowboy drawl
const VOICE = { name: "onyx", speed: 0.9, pitch: -1.0 };

const IDLE_POOL = ["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around","Sad Idle"];
const SKIT_POOL = [
  { anim:"Silly Dancing", lines:["Watch these bones boogie!","Dust off them boots!"] },
  { anim:"Waving",        lines:["Howdy there!","Over here!"] },
  { anim:"Laughing",      lines:["Heh-heh!","Ha! That tickles my funny bone!"] },
];

let scene,camera,renderer,clock,mixer,model,currentAction;
let recognition=null,isSpeaking=false,asleep=false;
let lastInteraction=Date.now();
const cache={};

// ---------- THREE ----------
function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,100);
  camera.position.set(0,1.6,5.5);           // a touch closer than v10.2

  const hemi=new THREE.HemisphereLight(0xffffff,0x3a3a3a,0.8);
  const key =new THREE.DirectionalLight(0xffffff,0.9); key.position.set(2,4,3);
  const fill=new THREE.DirectionalLight(0xffffff,0.35); fill.position.set(-2,2,-2);
  scene.add(hemi,key,fill);

  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableZoom=controls.enablePan=false;

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });

  // one-time audio unlock on first user gesture (prevents silent playback)
  function unlockAudio(){
    if (window._audioUnlocked) return;
    try{
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      ctx.resume();
      window._audioUnlocked = true;
      console.log("🔊 Audio unlocked");
    }catch{}
  }
  document.addEventListener("pointerdown", unlockAudio, { once:true });
}

// ---------- MATERIAL ----------
function applyBoneMaterial(root){
  const boneColor=new THREE.Color(0xE8E2D2);
  root.traverse(o=>{
    if(o.isMesh){
      o.material=new THREE.MeshStandardMaterial({
        color:boneColor,
        roughness:0.55,
        metalness:0.08
      });
    }
  });
}

// ---------- MODEL ----------
async function loadRig(){
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE+encodeURIComponent(DEFAULT_IDLE)+".fbx");
  fbx.scale.setScalar(1);
  applyBoneMaterial(fbx);
  scene.add(fbx);
  model=fbx;
  mixer=new THREE.AnimationMixer(model);

  const box=new THREE.Box3().setFromObject(model);
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  model.position.sub(center);
  camera.lookAt(0,size.y*0.5,0);
}

// ---------- ANIMS ----------
async function loadClip(name){
  if(cache[name]) return cache[name];
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE+encodeURIComponent(name)+".fbx");
  return (cache[name]=fbx.animations[0]);
}

// smoother global blending (fadeIn/fadeOut overlap)
async function play(name,loop=THREE.LoopRepeat,fade=0.9){
  if(!mixer) return;
  const clip=await loadClip(name);
  if(!clip) return;
  const next=mixer.clipAction(clip);
  next.enabled=true;
  next.reset();
  next.setLoop(loop,Infinity);
  next.clampWhenFinished=true;
  if(currentAction && currentAction!==next){
    currentAction.fadeOut(fade);
    next.fadeIn(fade);
  }
  next.play();
  currentAction=next;
  // console.log("🎬 Bob:",name);
}

// ---------- CHAT (with self-reference filter) ----------
async function askBob(prompt){
  try{
    // subtle waiting motion so he doesn’t freeze
    await play("Breathing Idle",THREE.LoopRepeat,0.6);

    const r=await fetch(WORKER_URL,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ prompt })
    });
    const j=await r.json();
    let reply=j.reply || "Well shoot, reckon I'm tongue-tied.";

    // Self-reference filter → first person
    reply = reply
      .replace(/\b[Bb]ob\s(thinks|believes|says|knows|feels|is)/g,"I $1")
      .replace(/\b[Bb]ob's\b/g,"my")
      .replace(/\b[Bb]obself\b/g,"myself")
      .replace(/\b[Bb]ob\b/g,"I")
      .replace(/\s{2,}/g," ")
      .trim();

    await say(reply);
  }catch(e){
    console.warn("⚠️ Chat error:",e);
  }
}

// ---------- SPEECH (story pacing + pitch/speed + amplitude sway) ----------
async function say(text){
  if(isSpeaking || !text) return;
  isSpeaking=true;
  try{
    recognition?.stop();

    // storytelling rhythm: tiny pre-breath + emotion pick
    let mood="Talking";
    if(/haha|lol|😂/.test(text)) mood="Laughing";
    else if(/\?$/.test(text))   mood="Shaking Head No";
    else if(/[!]$/.test(text))  mood="Yelling Out";

    // take a small breath before lines that have commas / ellipses
    const prePause = (text.includes(",") || text.includes("...")) ? 350 : 180;

    await play("Breathing Idle",THREE.LoopOnce,0.6);
    await new Promise(r=>setTimeout(r, prePause));
    await play(mood,THREE.LoopRepeat,0.6);

    const resp=await fetch(`${WORKER_URL}/tts`,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({
        text,
        voice: VOICE.name,
        speed: VOICE.speed,
        pitch: VOICE.pitch
      })
    });

    if(!resp.ok) throw new Error(`TTS ${resp.status}`);
    const blob=await resp.blob();
    const url=URL.createObjectURL(blob);
    const audio=new Audio(url);
    audio.volume=1.0;

    // amplitude-driven sway (gentle)
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const src=ctx.createMediaElementSource(audio);
    const analyser=ctx.createAnalyser();
    analyser.fftSize=1024;
    const data=new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(ctx.destination);

    let phase=0;
    function animateFromAudio(){
      analyser.getByteTimeDomainData(data);
      let avg=0; for(let i=0;i<data.length;i++) avg+=Math.abs(data[i]-128);
      avg/=data.length;
      const amp=avg/128;
      if(model){
        phase+=0.08;
        // smooth storytelling sway
        model.rotation.y += (Math.sin(phase*0.45)*0.025*amp - model.rotation.y)*0.20;
        model.rotation.x += (Math.sin(phase*0.90)*0.015*amp - model.rotation.x)*0.20;
      }
      if(isSpeaking) requestAnimationFrame(animateFromAudio);
    }
    requestAnimationFrame(animateFromAudio);

    // occasional hand gesture during long lines
    let gestureTimer=null;
    const gestureAnims=["Waving","Shrugging","Shaking Head No"];
    if(text.split(/\s+/).length>10){
      gestureTimer=setInterval(()=>{
        if(!isSpeaking || asleep) return;
        const pick=gestureAnims[Math.floor(Math.random()*gestureAnims.length)];
        play(pick,THREE.LoopOnce,0.6);
        setTimeout(()=>{ if(isSpeaking && !asleep) play("Talking",THREE.LoopRepeat,0.5); },1500);
      }, 3500 + Math.random()*2000);
    }

    audio.onended=()=>{
      if(gestureTimer) clearInterval(gestureTimer);
      isSpeaking=false;
      model.rotation.set(0,0,0);
      ctx.close();
      if(!asleep) play(DEFAULT_IDLE,THREE.LoopRepeat,1.0);
      try{recognition?.start();}catch{}
    };

    // ensure audio is allowed by browser; if not, will have been unlocked on first click
    await audio.play();

  }catch(e){
    console.warn("⚠️ TTS failed:",e);
    isSpeaking=false;
    if(!asleep) play(DEFAULT_IDLE);
  }
}

// ---------- MIC ----------
function initSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ console.warn("SpeechRecognition unsupported"); return; }
  recognition=new SR();
  recognition.continuous=true;
  recognition.lang="en-US";

  recognition.onresult=e=>{
    const text=e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    console.log("🗣️ Heard:",text);
    lastInteraction=Date.now();

    if(asleep){
      if(/hey\s*bob/.test(text)) heyBobDance();
      return;
    }

    if(!isSpeaking){
      if(/sleep|nap/.test(text)) goSleep();
      else if(/hey\s*bob/.test(text)) heyBobDance();
      else {
        // instant listening feedback
        play("Looking Around",THREE.LoopOnce,0.5);
        say("Hmm...");
        askBob(text);
      }
    }
  };

  recognition.onerror=e=>{
    console.warn("🎙️ Mic error:",e.error);
    if(e.error==="not-allowed") alert("Enable microphone permissions and reload the page.");
  };
  recognition.onend=()=>{
    if(!isSpeaking && !asleep){
      try{recognition.start();}catch{}
    }
  };

  console.log("🎙️ Mic ready — waiting for permission...");
  try{recognition.start();}catch(e){console.warn("Mic start error:",e);}
}

// ---------- BEHAVIORS ----------
async function goSleep(){
  if(asleep) return;
  asleep=true;
  await play("Sleeping Idle",THREE.LoopRepeat,1.0);
  await say("Catchin' me a bone nap...");
}
async function wakeBob(){
  if(!asleep) return;
  asleep=false;
  await play("Waking",THREE.LoopOnce,1.0);
  setTimeout(()=>play(DEFAULT_IDLE,THREE.LoopRepeat,1.0),1500);
  await say("Mornin', partner!");
}
async function heyBobDance(){
  asleep=false;
  await play("Silly Dancing",THREE.LoopRepeat,0.6);
  await say("Yee-haw! You called me, partner — time to dance!");
  setTimeout(()=>play(DEFAULT_IDLE,THREE.LoopRepeat,1.0),7000);
}

// ---------- IDLE / SKITS / STORY GESTURES / SLEEP ----------
function startIdleShifts(){
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since=Date.now()-lastInteraction;
    if(since>10000){
      const next=IDLE_POOL[Math.floor(Math.random()*IDLE_POOL.length)];
      await play(next,THREE.LoopRepeat,1.0);
    }
  },20000);
}
function startRandomSkits(){
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since=Date.now()-lastInteraction;
    if(since>20000){
      const pick=SKIT_POOL[Math.floor(Math.random()*SKIT_POOL.length)];
      await play(pick.anim,THREE.LoopOnce,1.0);
      await say(pick.lines[Math.floor(Math.random()*pick.lines.length)]);
      setTimeout(()=>{ if(!asleep) play(DEFAULT_IDLE,THREE.LoopRepeat,1.0); },5000);
    }
  },60000 + Math.random()*60000);
}
function startStoryGestures(){
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since=Date.now()-lastInteraction;
    if(since>8000){
      const picks=["Shrugging","Waving","Looking Around","Laughing"];
      const pick=picks[Math.floor(Math.random()*picks.length)];
      await play(pick,THREE.LoopOnce,0.8);
      setTimeout(()=>{ if(!asleep) play(DEFAULT_IDLE,THREE.LoopRepeat,0.8); },4000);
    }
  },10000);
}
function startSleepTimer(){
  setInterval(()=>{
    if(asleep || isSpeaking) return;
    const idle=Date.now()-lastInteraction;
    if(idle>120000) goSleep();
  },10000);
}

// ---------- LOOP ----------
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  mixer?.update(dt);
  renderer.render(scene,camera);
}

// ---------- BOOT ----------
async function initBob(){
  try{
    initThree();
    await loadRig();
    await play(DEFAULT_IDLE);
    document.body.addEventListener("click",()=>{
      if(!recognition){
        initSpeech();
        alert("🎙️ Mic activated — say 'Hey Bob' to test!");
      }
    },{once:true});
    startIdleShifts();
    startRandomSkits();
    startStoryGestures();
    startSleepTimer();
    animate();
  }catch(e){ console.error("❌ Boot failed:",e); }
}

setTimeout(initBob,800);
