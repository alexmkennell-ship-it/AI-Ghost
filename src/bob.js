// Bob v10 — Expressive Cowboy (Amplitude + Emotion + Gestures + Hey Bob Dance)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

console.log("🤠 Bob v10 — Expressive Cowboy online");

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";

const IDLE_POOL  = ["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around","Sad Idle"];
const SKIT_POOL  = [
  { anim:"Silly Dancing", lines:["Watch these bones boogie!","Dust off them boots!"] },
  { anim:"Waving", lines:["Howdy there!","Over here!"] },
  { anim:"Laughing", lines:["Heh-heh!","Ha! That tickles my funny bone!"] },
];
const DEFAULT_IDLE = "Neutral Idle";

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
  camera.position.set(0,1.6,8); // farther back for full body

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
async function play(name,loop=THREE.LoopRepeat,fade=0.25){
  if(!mixer) return;
  const clip=await loadClip(name);
  if(!clip) return;
  const act=mixer.clipAction(clip);
  act.reset(); act.setLoop(loop,Infinity);
  if(currentAction && currentAction!==act) currentAction.crossFadeTo(act,fade,false);
  act.play(); currentAction=act;
  console.log("🎬 Bob:",name);
}

// ---------- SPEECH ----------
async function say(text){
  if(isSpeaking || !text) return;
  isSpeaking=true;
  try{
    recognition?.stop();

    // emotion detection
    let emotionAnim="Talking";
    if(/haha|lol|😂/.test(text)) emotionAnim="Laughing";
    else if(/[!?]$/.test(text)) emotionAnim="Yelling Out";
    else if(/\?$/.test(text)) emotionAnim="Shaking Head No";

    await play(emotionAnim,THREE.LoopRepeat,0.25);

    const resp=await fetch(`${WORKER_URL}/tts`,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({text,voice:"onyx"})
    });
    const blob=await resp.blob();
    const url=URL.createObjectURL(blob);
    const audio=new Audio(url);

    // audio analyzer for head motion
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const src=ctx.createMediaElementSource(audio);
    const analyser=ctx.createAnalyser();
    analyser.fftSize=2048;
    const data=new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(ctx.destination);

    let jawPhase=0;
    function animateFromAudio(){
      analyser.getByteTimeDomainData(data);
      let avg=0;
      for(let i=0;i<data.length;i++) avg+=Math.abs(data[i]-128);
      avg/=data.length;
      const amp=avg/128;
      if(model){
        jawPhase+=0.12;
        model.rotation.x=Math.sin(jawPhase)*0.02*amp;
        model.rotation.y=Math.sin(jawPhase*0.3)*0.04*amp;
      }
      if(isSpeaking) requestAnimationFrame(animateFromAudio);
    }
    requestAnimationFrame(animateFromAudio);

    // random gesture triggers
    const gestureAnims=["Waving","Shrugging","Shaking Head No"];
    const gestureTimer=setInterval(()=>{
      if(Math.random()<0.5 && !asleep && isSpeaking){
        const pick=gestureAnims[Math.floor(Math.random()*gestureAnims.length)];
        play(pick,THREE.LoopOnce,0.2);
        setTimeout(()=>{ if(isSpeaking && !asleep) play("Talking",THREE.LoopRepeat,0.2); },1500);
      }
    },3000);

    audio.onended=()=>{
      clearInterval(gestureTimer);
      isSpeaking=false;
      model.rotation.set(0,0,0);
      ctx.close();
      if(!asleep) play(DEFAULT_IDLE);
      try{recognition?.start();}catch{}
    };
    await audio.play();
  }catch(e){
    console.warn("⚠️ TTS:",e);
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
    lastInteraction=Date.now();
    if(asleep){
      if(/hey\s*bob/.test(text)) heyBobDance();
      return;
    }
    if(!isSpeaking){
      if(/sleep|nap/.test(text)) goSleep();
      else if(/hey\s*bob/.test(text)) heyBobDance();
      else askBob(text);
    }
  };
  recognition.onend=()=>{ if(!isSpeaking && !asleep) try{recognition.start();}catch{} };
  recognition.start();
  console.log("🟢 Bob listening...");
}

// ---------- BEHAVIORS ----------
async function goSleep(){
  if(asleep) return;
  asleep=true;
  await play("Sleeping Idle");
  await say("Catchin' me a bone nap...");
}
async function wakeBob(){
  if(!asleep) return;
  asleep=false;
  await play("Waking",THREE.LoopOnce);
  setTimeout(()=>play(DEFAULT_IDLE),1200);
  await say("Mornin', partner!");
}
async function heyBobDance(){
  asleep=false;
  await play("Silly Dancing",THREE.LoopRepeat);
  await say("Yee-haw! You called me, partner — time to dance!");
  setTimeout(()=>play(DEFAULT_IDLE),7000);
}

// ---------- IDLE SHIFTS + SKITS ----------
function startIdleShifts(){
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since=Date.now()-lastInteraction;
    if(since>10000){
      const next=IDLE_POOL[Math.floor(Math.random()*IDLE_POOL.length)];
      await play(next);
    }
  },20000);
}
function startRandomSkits(){
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since=Date.now()-lastInteraction;
    if(since>20000){
      const pick=SKIT_POOL[Math.floor(Math.random()*SKIT_POOL.length)];
      await play(pick.anim,THREE.LoopOnce);
      await say(pick.lines[Math.floor(Math.random()*pick.lines.length)]);
      setTimeout(()=>{ if(!asleep) play(DEFAULT_IDLE); },5000);
    }
  },60000 + Math.random()*60000);
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
    document.body.addEventListener("click",()=>{ if(!recognition) initSpeech(); });
    startIdleShifts();
    startRandomSkits();
    startSleepTimer();
    animate();
  }catch(e){ console.error("❌ Boot:",e); }
}

setTimeout(initBob,1500);
