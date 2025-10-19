// Bob v8.9 — Bone-only + Skits + Sleep/Wake
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

console.log("🟢 Bob v8.9 (bone-only with skits & sleep) init");

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const DEFAULT_IDLE = "Neutral Idle";

let scene, camera, renderer, clock, mixer, model, currentAction;
let recognition = null, isSpeaking = false, asleep = false;
let lastInteraction = Date.now();
const cache = {};

// ---------- THREE ----------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(0,1.6,4);

  const hemi = new THREE.HemisphereLight(0xffffff,0x3a3a3a,0.7);
  const key  = new THREE.DirectionalLight(0xffffff,0.9); key.position.set(2,4,3);
  const fill = new THREE.DirectionalLight(0xffffff,0.35); fill.position.set(-2,2,-2);
  scene.add(hemi,key,fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = controls.enablePan = false;

  clock = new THREE.Clock();
  window.addEventListener("resize", ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------- MATERIAL ----------
function applyBoneMaterial(root){
  const boneColor = new THREE.Color(0xE8E2D2);
  root.traverse(o=>{
    if(o.isMesh){
      o.material = new THREE.MeshStandardMaterial({
        color: boneColor,
        roughness: 0.55,
        metalness: 0.08,
      });
      o.material.needsUpdate = true;
    }
  });
}

// ---------- MODEL / ANIMS ----------
async function loadRig(){
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + "T-Pose.fbx");
  fbx.scale.setScalar(1);
  applyBoneMaterial(fbx);
  scene.add(fbx);
  model = fbx;
  mixer = new THREE.AnimationMixer(model);
}

async function loadClip(name){
  if(cache[name]) return cache[name];
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + encodeURIComponent(name) + ".fbx");
  return (cache[name] = fbx.animations[0]);
}

async function play(name=DEFAULT_IDLE, loop=THREE.LoopRepeat){
  if(!mixer) return;
  const clip = await loadClip(name);
  if(!clip) return;
  const act = mixer.clipAction(clip);
  act.reset();
  act.setLoop(loop,Infinity);
  if(currentAction && currentAction!==act) currentAction.crossFadeTo(act,0.35,false);
  act.play();
  currentAction = act;
  console.log("🤠 Bob action:", name);
}

// ---------- SPEECH ----------
async function say(text){
  if(isSpeaking || !text) return;
  isSpeaking = true;
  try{
    recognition?.stop();
    const resp = await fetch(`${WORKER_URL}/tts`,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ text, voice:"onyx" })
    });
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = ()=>{ isSpeaking=false; if(!asleep) try{recognition?.start();}catch{} };
    await audio.play();
  }catch(e){ console.warn("⚠️ TTS:",e); isSpeaking=false; }
}

async function askBob(prompt){
  try{
    const r = await fetch(WORKER_URL,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ prompt })
    });
    const j = await r.json();
    const reply = j.reply || "Well shoot, reckon I'm tongue-tied.";
    await say(reply);
  }catch(e){ console.warn("⚠️ Chat:",e); }
}

// ---------- MIC ----------
function initSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ console.warn("SpeechRecognition unsupported"); return; }
  recognition = new SR();
  recognition.continuous = true;
  recognition.lang = "en-US";

  recognition.onresult = e=>{
    const text = e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    lastInteraction = Date.now();
    if(asleep){
      if(/hey\s*bob/.test(text)){ wakeBob(); }
      return;
    }
    if(!isSpeaking){
      if(/sleep|nap/.test(text)) goSleep();
      else askBob(text);
    }
  };
  recognition.onend = ()=>{ if(!isSpeaking && !asleep) try{recognition.start();}catch{} };
  recognition.start();
  console.log("🟢 Bob listening...");
}

// ---------- BEHAVIORS ----------
async function goSleep(){
  if(asleep) return;
  asleep = true;
  await play("Sleeping Idle");
  await say("Catchin' me a bone nap...");
}
async function wakeBob(){
  if(!asleep) return;
  asleep = false;
  await play("Waking", THREE.LoopOnce);
  setTimeout(()=>play(DEFAULT_IDLE),1200);
  await say("Mornin', partner!");
}

// ---------- RANDOM SKITS ----------
function startRandomSkits(){
  const skits = [
    { anim:"Silly Dancing", lines:["Watch these bones boogie!","Dust off them boots!"] },
    { anim:"Waving", lines:["Howdy there!","Over here!"] },
    { anim:"Laughing", lines:["Heh-heh!","Ha! That tickles my funny bone!"] },
    { anim:"Looking Around", lines:["Where’d everybody go?","Feels mighty quiet ‘round here."] },
  ];

  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since = Date.now() - lastInteraction;
    if(since > 20000){  // only if idle
      const pick = skits[Math.floor(Math.random()*skits.length)];
      await play(pick.anim, THREE.LoopOnce);
      await say(pick.lines[Math.floor(Math.random()*pick.lines.length)]);
      setTimeout(()=>{ if(!asleep) play(DEFAULT_IDLE); }, 5000);
    }
  }, 45000 + Math.random()*45000);
}

// ---------- AUTO-SLEEP TIMER ----------
function startSleepTimer(){
  setInterval(()=>{
    if(asleep || isSpeaking) return;
    const idleTime = Date.now() - lastInteraction;
    if(idleTime > 120000){ // 2 minutes
      goSleep();
    }
  }, 10000);
}

// ---------- LOOP ----------
function animate(){
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
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
    startRandomSkits();
    startSleepTimer();
    animate();
  }catch(e){ console.error("❌ Boot:",e); }
}

setTimeout(initBob,1500);
