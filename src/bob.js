// Bob v10.7 — Cinematic Edition (ghost shader, cinematic blends, idle stories, progress, auto-unlock)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

console.log("🎬 Bob v10.7 — Cinematic online");

const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/Neutral%20Idle.fbx";
const DEFAULT_IDLE = "Neutral Idle";
const VOICE = { name:"onyx", speed:0.8, pitch:-2.0 };

// ---------- Authoritative animation catalog ----------
const BOB_ANIMATIONS = Object.freeze([
  "Neutral Idle","Breathing Idle","Idle","Bored","Looking Around","Lying Down",
  "Sleeping Idle","Sleeping Idle (1)","Waking","Silly Dancing","Walkingsneakily",
  "Walking","Walkinglikezombie","Stop Walking","Waving","Shaking Head No",
  "Shrugging","Talking","Laughing","Defeated","Sad Idle","Yelling Out"
]);
const POOL_IDLE = ["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around","Sad Idle"];
const POOL_EXPRESSIVE = ["Silly Dancing","Waving","Laughing","Shaking Head No","Shrugging","Yelling Out"];
const PRELOAD_ANIMS = [...new Set([...BOB_ANIMATIONS])];

const SKITS_DEF = [
  { anim:"Silly Dancing",      lines:["Watch these bones boogie!","Dust off them boots!"] },
  { anim:"Waving",             lines:["Howdy there!","Over here!"] },
  { anim:"Laughing",           lines:["Heh-heh!","Ha! That tickles my funny bone!"] },
  { anim:"Shaking Head No",    lines:["Mmm-mmm.","Not quite, partner."] },
  { anim:"Shrugging",          lines:["Could go either way.","Reckon I’m not sure."] },
  { anim:"Looking Around",     lines:["Where’d everybody go?","Quiet as a church mouse."] },
  { anim:"Walkinglikezombie",  lines:["Brains—kiddin’ ya!","Stretchin’ the joints."] }
];

let scene,camera,renderer,clock,mixer,model,currentAction,controls;
let recognition=null,isSpeaking=false,asleep=false;
let lastInteraction=Date.now();
const cache={};
const availableClips=new Set();
let playQueuePromise=Promise.resolve();

// ---------- Loading overlay ----------
function createLoadingOverlay(){
  const el=document.createElement("div");
  el.id="bobLoading";
  el.style.cssText=`
    position:fixed;inset:0;background:#000;display:flex;flex-direction:column;
    justify-content:center;align-items:center;color:#b8ffb8;font-family:monospace;
    z-index:9999;transition:opacity .6s ease;`;
  el.innerHTML=`
    <div style="font-size:.95rem;opacity:.9;">Loading Bob...</div>
    <div id="bobProgress" style="width:60%;height:12px;border:1px solid #b8ffb8;margin-top:14px">
      <div id="bobBar" style="width:0%;height:100%;background:#b8ffb8;transition:width .2s"></div>
    </div>
    <div id="bobStatus" style="margin-top:8px;font-size:.85rem;opacity:.85">Initializing…</div>
  `;
  document.body.appendChild(el);
  return el;
}

// ---------- Three ----------
function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,100);
  camera.position.set(0,1.6,5.0); // slightly closer than v10.6

  const hemi=new THREE.HemisphereLight(0xffffff,0x3a3a3a,0.9);
  const key =new THREE.DirectionalLight(0xffffff,1.0); key.position.set(2.2,4.2,3.2);
  const fill=new THREE.DirectionalLight(0xffffff,0.35); fill.position.set(-2.0,2.0,-2.6);
  scene.add(hemi,key,fill);

  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableZoom=false; controls.enablePan=false;

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });

  // Quiet noisy FBX weight warnings
  const _warn=console.warn;
  console.warn=(...a)=>{ if(String(a[0]).includes("skinning weights")) return; _warn(...a); };

  // Audio unlock fallback on first real gesture
  document.addEventListener("pointerdown",()=>{
    if(window._audioUnlocked) return;
    try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); ctx.resume(); window._audioUnlocked=true; console.log("🔊 Audio unlocked"); }catch{}
  },{once:true});
}

// ---------- Ghost shader material ----------
function applyGhostMaterial(root){
  const base = new THREE.MeshStandardMaterial({
    color:new THREE.Color(0xE8E2D2),
    roughness:0.52, metalness:0.08,
    transparent:true, opacity:0.9,
    emissive:new THREE.Color(0x96FFE6), emissiveIntensity:0.055
  });

  root.traverse(o=>{
    if(!o.isMesh) return;
    o.material = base.clone();
    o.material.onBeforeCompile = (shader)=>{
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uRimColor = { value: new THREE.Color(0x96FFE6) };
      shader.uniforms.uRimMix = { value: 0.08 };
      shader.uniforms.uShimmer = { value: 0.03 };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNormal;
         uniform float uTime;`
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 wp = modelMatrix * vec4(transformed,1.0);
         vWPos = wp.xyz;
         vWNormal = normalize(mat3(modelMatrix)*objectNormal);
         // tiny shimmer displacement
         float s = sin(uTime*0.9 + wp.y*1.7 + wp.x*0.3)*0.0008;
         transformed += normal * s;
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNormal;
         uniform vec3 uRimColor;
         uniform float uRimMix;
         uniform float uShimmer;
         uniform float uTime;`
      ).replace(
        '#include <output_fragment>',
        `
         vec3 V = normalize(cameraPosition - vWPos);
         float f = pow(1.0 - max(0.0, dot(normalize(vWNormal), V)), 2.0);
         vec3 rim = uRimColor * f * uRimMix;
         float tw = (sin(uTime*2.0 + vWPos.y*2.3) * 0.5 + 0.5) * uShimmer;
         gl_FragColor.rgb = (gl_FragColor.rgb + rim) * (1.0 + tw);
         #include <output_fragment>
        `
      );
      o.userData._tickShader = (t)=>{ shader.uniforms.uTime.value = t; };
    };
  });
}

// ---------- Model ----------
async function loadRig(){
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE+encodeURIComponent(DEFAULT_IDLE)+".fbx");
  fbx.scale.setScalar(1);
  applyGhostMaterial(fbx);
  scene.add(fbx);

  model=fbx;
  mixer=new THREE.AnimationMixer(model);

  const box=new THREE.Box3().setFromObject(model);
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  model.position.sub(center);
  camera.lookAt(0,size.y*0.5,0);
}

// ---------- Animations (preload + queued plays) ----------
async function loadClip(name){
  if(cache[name]) return cache[name];
  try{
    const loader=new FBXLoader();
    const fbx=await loader.loadAsync(FBX_BASE+encodeURIComponent(name)+".fbx");
    const clip=fbx.animations?.[0];
    if(clip){ cache[name]=clip; availableClips.add(name); }
    return clip;
  }catch{
    console.warn("⚠️ Missing anim:", name);
    return null;
  }
}
function enqueuePlay(name,loop=THREE.LoopRepeat,fade=1.2){
  playQueuePromise = playQueuePromise.then(()=> playNow(name,loop,fade)).catch(()=>{});
  return playQueuePromise;
}
async function playNow(name,loop=THREE.LoopRepeat,fade=1.2){
  if(!mixer) return;
  const clip=await loadClip(name);
  if(!clip) return;
  const next=mixer.clipAction(clip);
  next.enabled=true; next.reset();
  next.setLoop(loop,Infinity); next.clampWhenFinished=true;

  if(currentAction && currentAction!==next){
    currentAction.crossFadeTo(next, fade, false);
  }else{
    next.fadeIn(fade*0.6);
  }
  next.play();
  currentAction=next;

  // camera focus pull on expressive moves
  if(POOL_EXPRESSIVE.includes(name)){
    softFocusOn(0.6);
  }
}
const play = enqueuePlay;

// ---------- Camera drift + focus pull ----------
let focusT=0;
function softFocusOn(amount=0.6){ focusT = Math.min(1, focusT + amount); }
function updateCamera(dt){
  // gentle drift
  const t = performance.now()*0.0002;
  const offX = Math.sin(t)*0.09;
  const offZ = Math.cos(t*0.85)*0.11;
  const anchor = new THREE.Vector3(0,1.6,5.0);
  camera.position.lerp(new THREE.Vector3(anchor.x+offX, anchor.y, anchor.z+offZ), 0.05);

  // focus pull (slight zoom-in during expressive, zoom-out over time)
  const targetZ = 4.6 + 0.6*(1-focusT);
  camera.position.z += (targetZ - camera.position.z)*0.04;
  focusT = Math.max(0, focusT - dt*0.25);

  controls.target.lerp(new THREE.Vector3(0,1.0,0), 0.06);
  controls.update();
}

// ---------- Chat (robust: JSON or text) ----------
async function askBob(prompt){
  try{
    const r = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ prompt })
    });

    let reply = "Well shoot, reckon I'm tongue-tied.";
    const ct = r.headers.get("content-type") || "";
    try{
      if(ct.includes("application/json")){
        const j = await r.json();
        reply = (j && (j.reply || j.text || j.message)) || reply;
      }else{
        const t = await r.text();
        reply = (t && t.trim()) || reply;
      }
    }catch{}

    await say(reply);
  }catch(e){
    console.warn("⚠️ Chat error:", e);
  }
}

// ---------- Speech (story pacing, gestures, amplitude sway) ----------
async function say(text){
  if(isSpeaking || !text) return;
  isSpeaking = true;
  try{
    recognition?.stop();

    let mood="Talking";
    if(/haha|lol|😂/.test(text)) mood="Laughing";
    else if(/\?$/.test(text))   mood="Shaking Head No";
    else if(/[!]$/.test(text))  mood="Yelling Out";
    const prePause = (text.includes(",")||text.includes("...")) ? 320 : 160;

    await play("Breathing Idle", THREE.LoopOnce, 0.8);
    await new Promise(r=>setTimeout(r, prePause));
    await play(mood, THREE.LoopRepeat, 0.9);

    const resp = await fetch(`${WORKER_URL}/tts`,{
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ text, voice: VOICE.name, speed: VOICE.speed, pitch: VOICE.pitch })
    });
    if(!resp.ok) throw new Error(`TTS ${resp.status}`);

    const blob=await resp.blob();
    const url=URL.createObjectURL(blob);
    const audio=new Audio(url);
    audio.volume=1.0;

    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const src=ctx.createMediaElementSource(audio);
    const analyser=ctx.createAnalyser(); analyser.fftSize=1024;
    const data=new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser); analyser.connect(ctx.destination);

    let phase=0;
    function audioDrive(){
      analyser.getByteTimeDomainData(data);
      let avg=0; for(let i=0;i<data.length;i++) avg+=Math.abs(data[i]-128);
      avg/=data.length; const amp=avg/128;
      if(model){
        phase+=0.085;
        model.rotation.y += (Math.sin(phase*0.45)*0.022*amp - model.rotation.y)*0.22;
        model.rotation.x += (Math.sin(phase*0.90)*0.012*amp - model.rotation.x)*0.22;
      }
      if(isSpeaking) requestAnimationFrame(audioDrive);
    }
    requestAnimationFrame(audioDrive);

    // occasional gestures on long lines if available
    let timer=null;
    const gestures = ["Waving","Shrugging","Shaking Head No"].filter(a=>availableClips.has(a));
    if(text.split(/\s+/).length>10 && gestures.length){
      timer=setInterval(()=>{
        if(!isSpeaking || asleep) return;
        const pick = gestures[(Math.random()*gestures.length)|0];
        play(pick, THREE.LoopOnce, 0.8);
        setTimeout(()=>{ if(isSpeaking && !asleep) play("Talking", THREE.LoopRepeat, 0.7); }, 1400);
      }, 3000 + Math.random()*1800);
    }

    audio.onended=()=>{
      if(timer) clearInterval(timer);
      isSpeaking=false;
      model.rotation.set(0,0,0);
      ctx.close();
      if(!asleep) play(DEFAULT_IDLE, THREE.LoopRepeat, 1.1);
      try{ recognition?.start(); }catch{}
    };
    await audio.play();
  }catch(e){
    console.warn("⚠️ TTS failed:", e);
    isSpeaking=false;
    if(!asleep) play(DEFAULT_IDLE, THREE.LoopRepeat, 1.0);
  }
}

// ---------- Mic ----------
function initSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ console.warn("SpeechRecognition unsupported"); return; }
  recognition = new SR();
  recognition.continuous = true;
  recognition.lang = "en-US";

  recognition.onresult = e=>{
    const text = e.results[e.results.length-1][0].transcript.trim().toLowerCase();
    console.log("🗣️ Heard:", text);
    lastInteraction = Date.now();

    if(asleep){
      if(/^\s*hey\s*bob[!.?]*$/.test(text)) { heyBobDance(); }
      else if(/hey\s*bob/.test(text)) { heyBobDance().then(()=>askBob(text)); }
      return;
    }

    if(!isSpeaking){
      if(/sleep|nap/.test(text)) { goSleep(); return; }
      const shortHey = /^\s*hey\s*bob[!.?]*$/.test(text);
      if(shortHey){ heyBobDance(); return; }

      play("Looking Around", THREE.LoopOnce, 0.8);
      say("Hmm...");
      askBob(text);
    }
  };

  recognition.onerror = e=>{
    if(e.error==="no-speech") return;
    console.warn("🎙️ Mic error:", e.error);
    if(e.error==="not-allowed") alert("Enable microphone permissions and reload.");
  };
  recognition.onend = ()=>{
    if(!isSpeaking && !asleep){
      try{ recognition.start(); }catch{}
    }
  };

  try{ recognition.start(); }catch(err){ console.warn("Mic start error:", err); }
}

// ---------- Behaviors ----------
async function goSleep(){
  if(asleep) return;
  asleep=true;
  await play("Sleeping Idle", THREE.LoopRepeat, 1.2);
  await say("Catchin' me a bone nap...");
}
async function wakeBob(){
  if(!asleep) return;
  asleep=false;
  await play("Waking", THREE.LoopOnce, 1.2);
  setTimeout(()=>play(DEFAULT_IDLE, THREE.LoopRepeat, 1.1), 1500);
  await say("Mornin', partner!");
}
async function heyBobDance(){
  asleep=false;
  await play("Silly Dancing", THREE.LoopRepeat, 1.0);
  await say("Yee-haw! You called me, partner — time to dance!");
  setTimeout(()=>play(DEFAULT_IDLE, THREE.LoopRepeat, 1.1), 6500);
}

// ---------- Idle systems ----------
function startIdleShifts(){
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since = Date.now() - lastInteraction;
    if(since > 9000){
      const pool = POOL_IDLE.filter(a=>availableClips.has(a));
      if(!pool.length) return;
      const next = pool[(Math.random()*pool.length)|0];
      await play(next, THREE.LoopRepeat, 1.1);
    }
  }, 17000);
}

function startRandomSkits(){
  const SKITS = SKITS_DEF.filter(s=>availableClips.has(s.anim));
  if(!SKITS.length) return;
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since = Date.now() - lastInteraction;
    if(since > 20000){
      const pick = SKITS[(Math.random()*SKITS.length)|0];
      await play(pick.anim, THREE.LoopOnce, 1.2);
      await new Promise(r=>setTimeout(r, 350));
      await say(pick.lines[(Math.random()*pick.lines.length)|0]);
      setTimeout(()=>{ if(!asleep) play(DEFAULT_IDLE, THREE.LoopRepeat, 1.15); }, 4200);
    }
  }, 58000 + Math.random()*42000);
}

const STORY_LINES = [
  "Reminds me o’ a time out near Dusty Creek… wind talkin’ through the sage.",
  "If bones could dream, I’d be thinkin’ about wide skies and quiet trails.",
  "Ain’t much a sunrise can’t fix.",
  "Funny thing about silence — it’s full o’ stories if you listen close."
];
function startIdleStories(){
  setInterval(async()=>{
    if(!mixer || asleep || isSpeaking) return;
    const since = Date.now() - lastInteraction;
    if(since > 45000){ // long idle → mini-monologue
      await play("Breathing Idle", THREE.LoopRepeat, 1.1);
      await say(STORY_LINES[(Math.random()*STORY_LINES.length)|0]);
      setTimeout(()=>{ if(!asleep) play(DEFAULT_IDLE, THREE.LoopRepeat, 1.1); }, 3000);
    }
  }, 20000);
}

function startSleepTimer(){
  setInterval(()=>{
    if(asleep || isSpeaking) return;
    const idle = Date.now() - lastInteraction;
    if(idle > 120000) goSleep();
  }, 10000);
}

// ---------- Loop ----------
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  // tick ghost shader time
  scene.traverse(o=>{ if(o.isMesh && o.material && o.material.userData){} });
  const t = performance.now()/1000;
  scene.traverse(o=>{
    if(o.isMesh && o.material && o.material.onBeforeCompile && o.userData._tickShader){
      o.userData._tickShader(t);
    }
  });
  mixer?.update(dt);
  updateCamera(dt);
  renderer.render(scene,camera);
}

// ---------- Boot ----------
async function initBob(){
  const overlay=createLoadingOverlay();
  const bar=overlay.querySelector("#bobBar");
  const status=overlay.querySelector("#bobStatus");
  try{
    initThree();
    status.textContent="Loading model...";
    await loadRig();

    status.textContent="Preparing idle...";
    await play(DEFAULT_IDLE);
    animate();

    const total=PRELOAD_ANIMS.length;
    let done=0;
    for(const n of PRELOAD_ANIMS){
      await loadClip(n);
      done++;
      const pct=Math.floor((done/total)*100);
      bar.style.width=pct+"%";
      status.textContent=`Loading animations... ${pct}%`;
    }

    status.textContent="All set!";
    bar.style.width="100%";
    setTimeout(()=>{ overlay.style.opacity=0; setTimeout(()=>overlay.remove(),600); },700);

    // Auto-click → unlock TTS/mic
    const fakeClick=new MouseEvent("click",{bubbles:true,cancelable:true});
    document.body.dispatchEvent(fakeClick);
    document.body.addEventListener("click",()=>{ if(!recognition){ initSpeech(); console.log("🎙️ Mic activated."); } },{once:true});

    startIdleShifts();
    startRandomSkits();
    startIdleStories();
    startSleepTimer();
  }catch(e){
    console.error("❌ Boot failed:",e);
    status.textContent="Error loading Bob!";
    bar.style.background="#f55";
  }
}

setTimeout(initBob,700);
