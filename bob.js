/* Autonomous Bob v7.6 — tuned for ghotsaiv1.alexmkennell.workers.dev (models + tts + chat) */
console.log("🟢 Bob v7.6 init");

// ================= CONFIG =================
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE   = "T-Pose.fbx";
const WORKER_TTS = "https://ghostaiv1.alexmkennell.workers.dev/tts";
const WORKER_CHAT= "https://ghostaiv1.alexmkennell.workers.dev/";

const CAMERA_ANCHOR = new THREE.Vector3(0,1.6,4);
const DRIFT_RADIUS = 0.15, RECENTER_EASE = 0.05, DRIFT_RETURN_MS = 12000;
const WALK_AWAY_Z = 8, WALK_SPEED = 1.5, SCALE_MIN = 0.25;
const IDLE_MIN_MS = 15000, IDLE_MAX_MS = 30000;

// ================= GLOBALS =================
let scene,camera,renderer,clock,mixer,model,currentAction,controls;
let jawBone=null,mouthMorphTargets=[];
let isWalkingAway=false,isSleeping=false,lastAnimName=null;
let recognition=null,jawPhase=0,lastResultAt=0,lastConfidence=0;
const cache={};

// ================= HELPERS =================
function rand(min,max){return Math.random()*(max-min)+min;}
function choice(arr,a){const f=a?arr.filter(x=>x!==a):arr;return f[Math.floor(Math.random()*f.length)]||arr[0];}
function showWarnBadge(){if(document.getElementById("bob-warn"))return;const b=document.createElement("div");b.id="bob-warn";b.textContent="⚠️";b.style.cssText="position:fixed;top:10px;right:10px;font-size:24px;z-index:9999;user-select:none;";document.body.appendChild(b);}

// ================= THREE INIT =================
function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  if("outputColorSpace" in renderer)renderer.outputColorSpace=THREE.SRGBColorSpace;else renderer.outputEncoding=THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,100);
  camera.position.copy(CAMERA_ANCHOR);

  const hemi=new THREE.HemisphereLight(0xffffff,0x444444,0.45);
  const key =new THREE.DirectionalLight(0xffffff,0.55);key.position.set(2,4,3);
  const fill=new THREE.DirectionalLight(0xffffff,0.25);fill.position.set(-2,2,-2);
  const rim =new THREE.DirectionalLight(0xaaffff,0.35);rim.position.set(-3,4,-2);
  scene.add(hemi,key,fill,rim);

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
  controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.enableRotate=controls.enableZoom=controls.enablePan=false;
  controls.target.set(0,1,0);
}

// ================= GHOST MATERIAL (balanced) =================
function makeGhostMaterial(){
  return new THREE.MeshPhysicalMaterial({
    color:0xE2E2E2,
    emissive:new THREE.Color(0xA7FFF5),
    emissiveIntensity:0.03,
    transparent:true,
    opacity:0.45,
    roughness:0.55,
    metalness:0.0,
    reflectivity:0.15,
    clearcoat:0.15,
    clearcoatRoughness:0.9,
    transmission:0.15,
    thickness:0.3,
    depthWrite:true,
    blending:THREE.NormalBlending
  });
}

// ================= LOAD RIG =================
async function loadRig(){
  const loader=new FBXLoader();
  const url=FBX_BASE+encodeURIComponent(RIG_FILE);
  const fbx=await loader.loadAsync(url);
  fbx.scale.setScalar(1);
  fbx.position.set(0,0,0);

  fbx.traverse(o=>{
    if(o.isMesh){
      o.material=makeGhostMaterial();
      if(o.morphTargetDictionary){
        for(const k in o.morphTargetDictionary)
          if(/jaw|mouth|open/i.test(k))
            mouthMorphTargets.push({mesh:o,idx:o.morphTargetDictionary[k]});
      }
    }
    if(o.isBone){
      const n=o.name.toLowerCase();
      if(/jaw/.test(n))jawBone=o;
      if(!jawBone&&/head/.test(n))jawBone=o;
    }
  });

  scene.add(fbx);
  model=fbx;
  mixer=new THREE.AnimationMixer(model);

  const box=new THREE.Box3().setFromObject(model);
  const size=box.getSize(new THREE.Vector3()).length();
  const center=box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/1.5,size/2.5,size/1.5)));
  controls.target.copy(center);
  camera.lookAt(center);
  return model;
}

// ================= ANIMATION =================
async function loadClip(name){
  if(cache[name])return cache[name];
  const l=new FBXLoader();
  const f=await l.loadAsync(FBX_BASE+encodeURIComponent(name)+".fbx");
  cache[name]=f.animations[0];
  return cache[name];
}
async function play(name,loop=THREE.LoopRepeat,fade=0.35){
  if(!mixer)return;
  const c=await loadClip(name);if(!c)return;
  const a=mixer.clipAction(c);a.reset();a.setLoop(loop,Infinity);
  if(currentAction&&currentAction!==a)currentAction.crossFadeTo(a,fade,false);
  a.play();currentAction=a;lastAnimName=name;
  console.log("🤠 Bob action:",name);
}

// ================= BEHAVIORS (sleep, idle, etc.) =================
const QUIPS={idle:["Just keepin' watch, partner.","Wind's colder than a ghost's breath.","Ain't much stirrin' out here."],
dance:["Watch these bones boogie!","Dust off them boots!"],
sleep:["Gonna catch me a quick shut-eye.","Dreamin' of tumbleweeds and campfires."],
walkAway:["Hold yer horses, be right back!","I'm moseyin' on for a spell."],
return:["Comin' on back, partner!","Miss me?"],
talk:["Well now, partner, here's a tall tale.","Speak plain and I'll do the same."],
yell:["Yeehaw!","Whooo-eee!","Heads up!"],
wave:["Howdy there!","Tip o’ the hat to ya!"]};

async function randomIdle(){await play(choice(["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around"],lastAnimName));maybeSay(QUIPS.idle);}
async function goSleepRandom(){isSleeping=true;await play(choice(["Sleeping Idle","Lying Down"],lastAnimName));maybeSay(QUIPS.sleep);}
async function wakeUpRandom(){if(!isSleeping)return;isSleeping=false;await play("Waking",THREE.LoopOnce);setTimeout(()=>play("Neutral Idle"),1200);maybeSay(QUIPS.return);}
async function doDanceRandom(){await play(choice(["Silly Dancing","Walkingsneakily"],lastAnimName));maybeSay(QUIPS.dance);}
async function yellBit(){await play("Yelling Out",THREE.LoopOnce);maybeSay(QUIPS.yell);}
async function waveHello(){await play("Waving",THREE.LoopOnce);maybeSay(QUIPS.wave);}
async function walkAwayAndReturn(){
  isWalkingAway=true;await play("Walking");maybeSay(QUIPS.walkAway);
  const start=performance.now(), dur=2000;
  await new Promise(r=>{function step(t){const k=Math.min(1,(t-start)/dur);model.position.z=WALK_AWAY_Z*k;model.scale.setScalar(1-(0.75*k));requestAnimationFrame(k<1?step:r);}requestAnimationFrame(step);});
  await new Promise(r=>setTimeout(r,800));maybeSay(QUIPS.return);
  await play("Walkinglikezombie");model.position.set(0,0,0);model.scale.setScalar(1);await play("Neutral Idle");isWalkingAway=false;
}

// ================= SPEECH =================
async function sayRandom(arr){
  if(!arr?.length)return;
  const phrase=choice(arr);
  console.log("💬 Bob said:",phrase);
  try{
    const resp=await fetch(WORKER_TTS,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text:phrase,voice:"onyx"})
    });
    const blob=await resp.blob();
    const a=new Audio(URL.createObjectURL(blob));
    a.volume=0.9;a.play();
  }catch(e){console.warn("⚠️ /tts failed:",e);}
}
function maybeSay(a){if(Math.random()<0.6)sayRandom(a);}

// optional chat
async function askBob(prompt){
  try{
    const r=await fetch(WORKER_CHAT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt})});
    const j=await r.json();sayRandom([j.reply||"Well shoot, reckon I'm tongue-tied."]);
  }catch(e){console.warn("⚠️ Chat error:",e);}
}

// ================= RECOGNITION =================
function initSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){console.warn("⚠️ SpeechRecognition unavailable");return;}
  recognition=new SR();recognition.lang="en-US";recognition.continuous=true;
  recognition.onresult=e=>{
    const res=e.results[e.resultIndex][0];const txt=res.transcript.toLowerCase().trim();
    lastResultAt=performance.now();lastConfidence=res.confidence??0;
    console.log(`🗣️ You said: "${txt}"`);
    handleCommand(txt);
  };
  recognition.onend=()=>{try{recognition.start();console.warn("⚠️ Speech restarted");}catch{}};
  recognition.start();console.log("🟢 Bob: Listening...");
  setInterval(()=>{if(performance.now()-lastResultAt>10000){try{recognition.stop();recognition.start();}catch{}}},15000);
}
function handleCommand(txt){
  if(/hey\s*bob/.test(txt))return wakeUpRandom();
  if(/dance|boogie/.test(txt))return doDanceRandom();
  if(/sleep|nap/.test(txt))return goSleepRandom();
  if(/walk away|leave/.test(txt))return walkAwayAndReturn();
  if(/come back|return/.test(txt))return wakeUpRandom();
  if(/wave|hello/.test(txt))return waveHello();
  if(/yell|shout/.test(txt))return yellBit();
  if(/talk|speak/.test(txt))return askBob("Say something, Bob!");
  randomIdle();
}

// ================= CAMERA DRIFT =================
let driftStart=performance.now();
function updateCamera(dt){
  const t=performance.now(), age=t-driftStart, ph=t*0.0002;
  const offX=Math.sin(ph)*DRIFT_RADIUS, offZ=Math.cos(ph*0.9)*DRIFT_RADIUS;
  const rec=Math.min(1,age/DRIFT_RETURN_MS), ease=RECENTER_EASE+rec*0.02;
  camera.position.lerp(new THREE.Vector3(CAMERA_ANCHOR.x+offX,CAMERA_ANCHOR.y,CAMERA_ANCHOR.z+offZ),0.05);
  camera.position.lerp(CAMERA_ANCHOR,ease);
  controls.target.lerp(new THREE.Vector3(0,1,0),0.08);controls.update();
  if(age>DRIFT_RETURN_MS*1.2)driftStart=t;
}
setInterval(()=>{camera.position.lerp(CAMERA_ANCHOR,0.15);controls.target.lerp(new THREE.Vector3(0,1,0),0.15);controls.update();},45000);

// ================= LOOP =================
function animate(){requestAnimationFrame(animate);const dt=clock.getDelta();mixer?.update(dt);updateCamera(dt);renderer.render(scene,camera);}

// ================= BOOT =================
(async()=>{
  try{
    if(typeof window.FBXLoader==="undefined"&&window.THREE&&THREE.FBXLoader)window.FBXLoader=THREE.FBXLoader;
    if(typeof THREE==="undefined"||typeof FBXLoader==="undefined")throw new Error("THREE/FBXLoader missing");
    initThree();await loadRig();await play("Neutral Idle");
    initSpeech();animate();
  }catch(e){console.error(e);showWarnBadge();}
})();
