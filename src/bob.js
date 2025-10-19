/* Bob v8.8 — Procedural Cowboy (no textures)
   - Denim/hat/boots/bone colors generated per-vertex by height
   - Subtle AO-ish joint darkening + soft rim highlight
   - Keeps mic + TTS via Worker (onyx), jaw flap, random idles
   - Minimal console logs only
*/

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js";
import { FBXLoader }   from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/controls/OrbitControls.js";

console.log("🟢 Bob v8.8 (procedural) init");

// ---------- CONFIG ----------
const WORKER_TTS  = "https://ghostaiv1.alexmkennell.workers.dev/tts";
const WORKER_CHAT = "https://ghostaiv1.alexmkennell.workers.dev/";
const FBX_BASE    = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE    = "T-Pose.fbx";

const CAMERA_ANCHOR = new THREE.Vector3(0, 1.6, 4);
const DRIFT_RADIUS  = 0.12;
const DRIFT_BACK_MS = 11000;

const ANIMS_IDLE  = ["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around","Sad Idle"];
const ANIMS_FUN   = ["Silly Dancing","Waving","Laughing","Yelling Out","Shaking Head No","Shrugging"];
const ANIMS_WALK  = ["Walking","Walkingsneakily","Walkinglikezombie","Stop Walking"];
const ANIMS_SLEEP = ["Sleeping Idle","Sleeping Idle (1)","Lying Down","Waking"];
const ANIMS_ALL   = [...new Set([...ANIMS_IDLE,...ANIMS_FUN,...ANIMS_WALK,...ANIMS_SLEEP,"Talking","Defeated"])];

const choice = (arr, avoid) => (avoid ? arr.filter(x=>x!==avoid):arr)[Math.floor(Math.random()*arr.length)] || arr[0];
const validPhrase = s => { if(!s) return false; const w=(s.toLowerCase().match(/\b[a-z]{3,}\b/g)||[]).length; return w>=3; };

// ---------- GLOBALS ----------
let scene,camera,renderer,controls,clock,mixer,model,currentAction;
let recognition=null,isSpeaking=false,isSleeping=false;
let jawBone=null,mouthMorphTargets=[];
const cache=Object.create(null);
let audioUnlocked=false;

// ---------- AUDIO UNLOCK ----------
function unlockAudioOnce(){
  if(audioUnlocked) return;
  audioUnlocked=true;
  try{
    const C=new (window.AudioContext||window.webkitAudioContext)();
    const b=C.createBuffer(1,1,22050);
    const s=C.createBufferSource(); s.buffer=b; s.connect(C.destination); s.start(0);
  }catch{}
}

// ---------- THREE SETUP ----------
function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,100);
  camera.position.copy(CAMERA_ANCHOR);

  const hemi=new THREE.HemisphereLight(0xffffff,0x404040,0.55);
  const key =new THREE.DirectionalLight(0xffffff,0.66); key.position.set(2.2,4.2,3);
  const fill=new THREE.DirectionalLight(0xffffff,0.30); fill.position.set(-2.2,2.0,-2.6);
  const rim =new THREE.DirectionalLight(0x9fffe0,0.28); rim.position.set(-3.2,4.0,-2.0);
  scene.add(hemi,key,fill,rim);

  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableRotate=controls.enableZoom=controls.enablePan=false;
  controls.target.set(0,1,0);

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });

  window.addEventListener("pointerdown",unlockAudioOnce,{once:true});
  window.addEventListener("keydown",unlockAudioOnce,{once:true});
}

// ---------- PROCEDURAL COLORS ----------
const COL={
  bone:new THREE.Color(0xE8E2D2),
  hat:new THREE.Color(0x6E4625),
  shirt:new THREE.Color(0x6B6A3F),
  denim:new THREE.Color(0x3F6A8F),
  boots:new THREE.Color(0x6A4B2A)
};
const lerpColor=(o,a,b,t)=>o.copy(a).lerp(b,THREE.MathUtils.clamp(t,0,1));

function applyGradientMaterial(mesh,bounds){
  const geo=mesh.geometry;
  if(!geo?.attributes?.position) return;
  const g=geo.index?geo.toNonIndexed():geo;
  const pos=g.attributes.position,vCount=pos.count;
  const minY=bounds.min.y,maxY=bounds.max.y,rangeY=Math.max(1e-6,maxY-minY);
  const colors=new Float32Array(vCount*3); const tmp=new THREE.Color();

  for(let i=0;i<vCount;i++){
    const y=pos.getY(i),t=(y-minY)/rangeY;
    if(t>0.84)       lerpColor(tmp,COL.hat,COL.bone,(t-0.84)/0.16);
    else if(t>0.62)  lerpColor(tmp,COL.shirt,COL.denim,(t-0.62)/0.20);
    else if(t>0.34)  tmp.copy(COL.denim);
    else             lerpColor(tmp,COL.boots,COL.bone,t/0.34);
    colors[i*3]=tmp.r; colors[i*3+1]=tmp.g; colors[i*3+2]=tmp.b;
  }
  g.setAttribute("color",new THREE.BufferAttribute(colors,3)); mesh.geometry=g;

  const mat=new THREE.MeshPhysicalMaterial({
    vertexColors:true,roughness:0.42,metalness:0.08,reflectivity:0.18,
    clearcoat:0.22,clearcoatRoughness:0.45,sheen:0.25,
    sheenColor:new THREE.Color(0xFFF2D8)
  });

  mat.onBeforeCompile=shader=>{
    shader.uniforms.fresnelColor={value:new THREE.Color(0x9FFFE0)};
    shader.uniforms.fresnelPower={value:2.0};
    shader.uniforms.fresnelMix={value:0.07};
    shader.uniforms.aoStrength={value:0.30};
    shader.vertexShader=shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWPos;varying vec3 vWNormal;'
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvec4 wp=modelMatrix*vec4(transformed,1.0);\nvWPos=wp.xyz;\nvWNormal=normalize(mat3(modelMatrix)*objectNormal);'
    );
    shader.fragmentShader=shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWPos;varying vec3 vWNormal;uniform vec3 fresnelColor;uniform float fresnelPower;uniform float fresnelMix;uniform float aoStrength;'
    ).replace(
      '#include <output_fragment>',
      'vec3 V=normalize(cameraPosition-vWPos);float f=pow(1.0-max(0.0,dot(normalize(vWNormal),V)),fresnelPower);vec3 rim=fresnelColor*f*fresnelMix;#ifdef GL_OES_standard_derivatives vec3 nrm=normalize(vWNormal);float curv=length(fwidth(nrm));float ao=clamp(curv*1.6,0.0,1.0)*aoStrength;#else float ao=0.0;#endif gl_FragColor.rgb=(gl_FragColor.rgb+rim)*(1.0-ao);\n#include <output_fragment>'
    );
  };
  mesh.material=mat;
}

// ---------- MODEL ----------
async function loadRig(){
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE+encodeURIComponent(RIG_FILE));
  fbx.scale.setScalar(1);
  const bb=new THREE.Box3().setFromObject(fbx);

  fbx.traverse(o=>{
    if(o.isBone){
      const n=o.name.toLowerCase();
      if(/jaw/.test(n)) jawBone=o;
      if(!jawBone&&/head/.test(n)) jawBone=o;
    }
    if(o.isMesh){
      if(o.morphTargetDictionary){
        for(const k in o.morphTargetDictionary)
          if(/jaw|mouth|open/i.test(k))
            mouthMorphTargets.push({mesh:o,idx:o.morphTargetDictionary[k]});
      }
      applyGradientMaterial(o,bb);
    }
  });
  scene.add(fbx);
  model=fbx;
  mixer=new THREE.AnimationMixer(model);
  return model;
}

async function loadClip(name){
  if(cache[name]) return cache[name];
  const l=new FBXLoader();
  const f=await l.loadAsync(FBX_BASE+encodeURIComponent(name)+".fbx");
  cache[name]=f.animations[0];
  return cache[name];
}
async function play(name,loop=THREE.LoopRepeat,fade=0.35){
  if(!mixer) return;
  const clip=await loadClip(name);
  if(!clip) return;
  const a=mixer.clipAction(clip);
  a.reset(); a.setLoop(loop,Infinity);
  if(currentAction&&currentAction!==a) currentAction.crossFadeTo(a,fade,false);
  a.play(); currentAction=a;
  console.log("🤠 Bob action:",name);
}

// ---------- JAW ----------
let jawEnabled=false,jawPhase=0;
const speakingJawEnable=v=>{jawEnabled=v;if(!v)resetJaw();};
function resetJaw(){
  if(jawBone) jawBone.rotation.x=0;
  mouthMorphTargets.forEach(({mesh,idx})=>{
    if(mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx]=0;
  });
}
function jawTick(dt){
  if(!jawEnabled) return;
  jawPhase+=dt*10;
  const amp=0.22+0.1*Math.sin(jawPhase*0.5);
  const open=Math.max(0,Math.sin(jawPhase))*amp;
  if(jawBone) jawBone.rotation.x=open*0.35;
  mouthMorphTargets.forEach(({mesh,idx})=>{
    if(mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx]=open;
  });
}

// ---------- TTS / CHAT ----------
async function say(text){
  if(!text) return;
  try{
    unlockAudioOnce();
    isSpeaking=true; recognition?.stop();
    const r=await fetch(WORKER_TTS,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({text,voice:"onyx"})
    });
    if(!r.ok) throw new Error(await r.text());
    const blob=await r.blob(); const url=URL.createObjectURL(blob);
    const a=new Audio(url); a.volume=0.85;
    a.onplay =()=>speakingJawEnable(true);
    a.onended=()=>{speakingJawEnable(false);isSpeaking=false;try{recognition?.start();}catch{}};
    await a.play();
  }catch(e){
    console.warn("⚠️ /tts failed:",e);
    speakingJawEnable(false);isSpeaking=false;try{recognition?.start();}catch{}
  }
}
async function askBob(prompt){
  try{
    const r=await fetch(WORKER_CHAT,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({prompt})
    });
    const j=await r.json();
    await say(j.reply||"Well shoot, reckon I'm tongue-tied.");
  }catch(e){ console.warn("⚠️ Chat error:",e); }
}

// ---------- MIC ----------
function initSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){console.warn("Speech API unavailable");return;}
  recognition=new SR(); recognition.lang="en-US"; recognition.continuous=true;
  recognition.onresult=e=>{
    if(isSpeaking) return;
    const res=e.results[e.results.length-1][0];
    const txt=(res.transcript||"").toLowerCase().trim();
    console.log(`🗣️ "${txt}"`);
    if(isSleeping){ if(/hey\s*bob/.test(txt)) wakeUp(); return; }
    if(/dance|boogie/.test(txt)) return doDance();
    if(/sleep|nap/.test(txt)) return goSleep();
    if(/wave|hello|hi\b/.test(txt)) return waveHello();
    if(validPhrase(txt)) askBob(txt);
  };
  recognition.onend=()=>{if(!isSpeaking)try{recognition.start();}catch{}};
  recognition.start(); console.log("🟢 Bob: Listening…");
}

// ---------- BEHAVIORS ----------
const randomIdle = async()=>play(choice(ANIMS_IDLE,currentAction?currentAction._clip?.name:null));
async function goSleep(){isSleeping=true;await play(choice(["Sleeping Idle","Lying Down"]));await say("Dreamin’ o’ tumbleweeds.");}
async function wakeUp(){if(isSleeping){isSleeping=false;await play("Waking",THREE.LoopOnce);setTimeout(()=>play("Neutral Idle"),1100);await say("Mornin’, partner.");}}
async function doDance(){await play(choice(["Silly Dancing","Walkingsneakily"]));await say("Watch these bones boogie!");}
async function waveHello(){await play("Waving",THREE.LoopOnce);await say("Howdy there!");}

// ---------- CAMERA + LOOP ----------
let driftStart=performance.now();
function updateCamera(){
  const t=performance.now(),age=t-driftStart,ph=t*0.00022;
  const offX=Math.sin(ph)*DRIFT_RADIUS,offZ=Math.cos(ph*0.9)*DRIFT_RADIUS;
  const targetPos=new THREE.Vector3(CAMERA_ANCHOR.x+offX,CAMERA_ANCHOR.y,CAMERA_ANCHOR.z+offZ);
  camera.position.lerp(targetPos,0.05);
  const ease=0.06+Math.min(1,age/DRIFT_BACK_MS)*0.02;
  camera.position.lerp(CAMERA_ANCHOR,ease);
  controls.target.lerp(new THREE.Vector3(0,1,0),0.08);
  controls.update();
  if(age>DRIFT_BACK_MS*1.15) driftStart=t;
}
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  mixer?.update(dt); jawTick(dt); updateCamera();
  renderer.render(scene,camera);
}

// ---------- BOOT ----------
(async()=>{
  try{
    initThree();
    await loadRig();
    await play("Neutral Idle");
    document.body.addEventListener("click",()=>{
      unlockAudioOnce();
      if(!recognition) initSpeech();
    },{once:true});
    animate();
  }catch(e){
    console.error("❌ Boot error:",e);
    const d=document.createElement("div");
    d.textContent="⚠️"; d.style.cssText="position:fixed;top:10px;right:10px;font-size:24px;z-index:9999";
    document.body.appendChild(d);
  }
})();
