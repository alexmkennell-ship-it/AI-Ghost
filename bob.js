/* Autonomous Bob v7.8 — full speech loop, mic mute while speaking, tuned for ghotsaiv1.alexmkennell.workers.dev */
console.log("🟢 Bob v7.8 init");

// ---------- CONFIG ----------
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE   = "T-Pose.fbx";
const WORKER_TTS = "https://ghostaiv1.alexmkennell.workers.dev/tts";
const WORKER_CHAT= "https://ghostaiv1.alexmkennell.workers.dev/";

const CAMERA_ANCHOR = new THREE.Vector3(0,1.6,4);
const DRIFT_RADIUS = 0.15, RECENTER_EASE = 0.05, DRIFT_RETURN_MS = 12000;

// ---------- GLOBALS ----------
let scene,camera,renderer,clock,mixer,model,currentAction,controls;
let jawBone=null,mouthMorphTargets=[];
let isSleeping=false,isSpeaking=false;
let recognition=null,lastResultAt=0;
const cache={};

// ---------- HELPERS ----------
function rand(min,max){return Math.random()*(max-min)+min;}
function choice(arr,avoid){if(!arr||!arr.length)return"";const f=avoid?arr.filter(a=>a!==avoid):arr;return f[Math.floor(Math.random()*f.length)]||arr[0];}
function showWarnBadge(){if(document.getElementById("bob-warn"))return;const b=document.createElement("div");b.id="bob-warn";b.textContent="⚠️";b.style.cssText="position:fixed;top:10px;right:10px;font-size:24px;z-index:9999;user-select:none;";document.body.appendChild(b);}

// ---------- THREE INIT ----------
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

// ---------- MATERIAL ----------
function makeGhostMaterial(){
  return new THREE.MeshPhysicalMaterial({
    color:0xE5E5E5,
    emissive:new THREE.Color(0xB0FFF2),
    emissiveIntensity:0.02,
    transparent:true,
    opacity:0.65,            // less ghosty
    roughness:0.45,
    metalness:0.05,
    reflectivity:0.15,
    clearcoat:0.1,
    transmission:0.05,
    thickness:0.25,
    depthWrite:true,
    blending:THREE.NormalBlending
  });
}

// ---------- LOAD RIG ----------
async function loadRig(){
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE+encodeURIComponent(RIG_FILE));
  fbx.scale.setScalar(1);
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
  controls.target.copy(center);camera.lookAt(center);
  return model;
}

// ---------- ANIMATION ----------
async function loadClip(n){if(cache[n])return cache[n];const l=new FBXLoader();const f=await l.loadAsync(FBX_BASE+encodeURIComponent(n)+".fbx");cache[n]=f.animations[0];return cache[n];}
async function play(n,loop=THREE.LoopRepeat,fade=0.35){if(!mixer)return;const c=await loadClip(n);if(!c)return;const a=mixer.clipAction(c);a.reset();a.setLoop(loop,Infinity);if(currentAction&&currentAction!==a)currentAction.crossFadeTo(a,fade,false);a.play();currentAction=a;console.log("🤠 Bob action:",n);}

// ---------- SPEECH ----------
async function say(text){
  if(!text)return;
  console.log("💬 Bob says:",text);
  try{
    isSpeaking=true; if(recognition) recognition.stop(); // mute mic
    const r=await fetch(WORKER_TTS,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,voice:"onyx"})});
    const b=await r.blob();const a=new Audio(URL.createObjectURL(b));
    a.volume=0.9;
    a.onended=()=>{isSpeaking=false;try{recognition?.start();}catch{};};
    await a.play();
  }catch(e){console.warn("⚠️ /tts failed:",e);isSpeaking=false;try{recognition?.start();}catch{};}
}

// ---------- CHAT ----------
async function askBob(prompt){
  try{
    const r=await fetch(WORKER_CHAT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt})});
    const j=await r.json();say(j.reply||"Well shoot, reckon I'm tongue-tied.");
  }catch(e){console.warn("⚠️ Chat error:",e);}
}

// ---------- BEHAVIORS ----------
const QUIPS={idle:["Ain't much stirrin' out here.","Just keepin' watch, partner.","Wind's colder than a ghost's breath."],
dance:["Watch these bones boogie!","Dust off them boots!"],
sleep:["Gonna catch me a quick shut-eye.","Dreamin' of tumbleweeds."],
walkAway:["Hold yer horses, be right back!"],
return:["Comin' on back, partner!","Miss me?"]};

async function randomIdle(){await play(choice(["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around"]));}
async function goSleepRandom(){isSleeping=true;await play(choice(["Sleeping Idle","Lying Down"]));say(choice(QUIPS.sleep));}
async function wakeUpRandom(){if(!isSleeping)return;isSleeping=false;await play("Waking",THREE.LoopOnce);setTimeout(()=>play("Neutral Idle"),1200);say(choice(QUIPS.return));}
async function doDanceRandom(){await play(choice(["Silly Dancing","Walkingsneakily"]));say(choice(QUIPS.dance));}
async function waveHello(){await play("Waving",THREE.LoopOnce);say("Howdy there!");}
async function walkAwayAndReturn(){
  await play("Walking");say(choice(QUIPS.walkAway));
  const dur=2000;const start=performance.now();
  await new Promise(r=>{function step(t){const k=Math.min(1,(t-start)/dur);model.position.z=8*k;model.scale.setScalar(1-(0.75*k));requestAnimationFrame(k<1?step:r);}requestAnimationFrame(step);});
  await new Promise(r=>setTimeout(r,800));say(choice(QUIPS.return));
  await play("Walkinglikezombie");model.position.set(0,0,0);model.scale.setScalar(1);await play("Neutral Idle");
}

// ---------- RECOGNITION ----------
function initSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){console.warn("SpeechRecognition unavailable");return;}
  recognition=new SR();recognition.lang="en-US";recognition.continuous=true;
  recognition.onresult=e=>{
    if(isSpeaking) return; // ignore own voice
    const res=e.results[e.resultIndex][0];
    const txt=res.transcript.toLowerCase().trim();
    lastResultAt=performance.now();
    console.log(`🗣️ You said: "${txt}"`);
    handleCommand(txt);
  };
  recognition.onend=()=>{if(!isSpeaking)try{recognition.start();}catch{};};
  recognition.start();console.log("🟢 Bob: Listening...");
}

function handleCommand(txt){
  if(/hey\s*bob/.test(txt)){wakeUpRandom();say("Well now partner, loud and clear!");return;}
  if(/dance|boogie/.test(txt)){doDanceRandom();return;}
  if(/sleep|nap/.test(txt)){goSleepRandom();return;}
  if(/walk away|leave/.test(txt)){walkAwayAndReturn();return;}
  if(/come back|return/.test(txt)){wakeUpRandom();return;}
  if(/wave|hello/.test(txt)){waveHello();return;}
  if(/talk|speak/.test(txt)){askBob("Say something, Bob!");return;}
  say("Can't quite make that out, partner.");randomIdle();
}

// ---------- CAMERA ----------
let driftStart=performance.now();
function updateCamera(dt){
  const t=performance.now(),age=t-driftStart,ph=t*0.0002;
  const offX=Math.sin(ph)*DRIFT_RADIUS,offZ=Math.cos(ph*0.9)*DRIFT_RADIUS;
  const rec=Math.min(1,age/DRIFT_RETURN_MS),ease=RECENTER_EASE+rec*0.02;
  camera.position.lerp(new THREE.Vector3(CAMERA_ANCHOR.x+offX,CAMERA_ANCHOR.y,CAMERA_ANCHOR.z+offZ),0.05);
  camera.position.lerp(CAMERA_ANCHOR,ease);
  controls.target.lerp(new THREE.Vector3(0,1,0),0.08);controls.update();
  if(age>DRIFT_RETURN_MS*1.2)driftStart=t;
}
setInterval(()=>{camera.position.lerp(CAMERA_ANCHOR,0.15);controls.target.lerp(new THREE.Vector3(0,1,0),0.15);controls.update();},45000);

// ---------- LOOP ----------
function animate(){requestAnimationFrame(animate);const dt=clock.getDelta();mixer?.update(dt);updateCamera(dt);renderer.render(scene,camera);}

// ---------- BOOT ----------
(async()=>{
  try{
    if(typeof window.FBXLoader==="undefined"&&window.THREE&&THREE.FBXLoader)window.FBXLoader=THREE.FBXLoader;
    initThree();await loadRig();await play("Neutral Idle");
    window.addEventListener("click",()=>{const s=new Audio();s.play().catch(()=>{});},{once:true}); // unlock audio
    initSpeech();animate();
  }catch(e){console.error(e);showWarnBadge();}
})();
