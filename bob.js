/* Autonomous Bob v7.1 — silent stage, console debug, jaw & voice, all anims (no T-Pose) */
console.log("🟢 Bob v7.1 init");

// ---------- CONFIG ----------
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE = "T-Pose.fbx"; // rig only; do NOT play as anim

// All animations you listed (excluding T-Pose)
const ANIMS = {
  idle: [
    "Neutral Idle","Breathing Idle","Idle","Bored","Looking Around",
    "Shrugging","Laughing","Sad Idle","Defeated"
  ],
  sleep: [
    "Sleeping Idle","Sleeping Idle (1)","Lying Down"
  ],
  movement: [
    "Walking","Walkinglikezombie","Walkingsneakily","Stop Walking","Waking"
  ],
  expressive: [
    "Talking","Waving","Shaking Head No","Yelling Out","Silly Dancing","Laughing","Looking Around"
  ]
};
const ALL_ANIMS = [...new Set([...ANIMS.idle, ...ANIMS.sleep, ...ANIMS.movement, ...ANIMS.expressive])];

// Idle timing and wander config
const IDLE_MIN_MS = 15000, IDLE_MAX_MS = 30000;
const WALK_AWAY_Z = 8, WALK_SPEED = 1.5, SCALE_MIN = 0.25;

// ---------- WARN BADGE ----------
function showWarnBadge() {
  if (document.getElementById("bob-warn")) return;
  const b = document.createElement("div");
  b.id = "bob-warn";
  b.textContent = "⚠️";
  b.style.cssText = "position:fixed;top:10px;right:10px;font-size:24px;z-index:9999;user-select:none;";
  document.body.appendChild(b);
}

// ---------- THREE CORE ----------
let scene, camera, renderer, clock, mixer, model, currentAction, controls;
let jawBone = null;
let mouthMorphTargets = []; // {mesh, key, idx}
let isWalkingAway = false, isSleeping = false, lastAnimName = null;

const cache = {};
const textureCache = {};
function rand(min,max){return Math.random()*(max-min)+min;}
function choice(arr, avoid){const f=avoid?arr.filter(a=>a!==avoid):arr;return f[Math.floor(Math.random()*f.length)]||arr[0];}

function initThree(){
  renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(0,1.6,4);

  const hemi=new THREE.HemisphereLight(0xffffff,0x444444,0.45);
  const key =new THREE.DirectionalLight(0xffffff,0.55); key.position.set(2,4,3);
  const fill=new THREE.DirectionalLight(0xffffff,0.25); fill.position.set(-2,2,-2);
  const rim =new THREE.DirectionalLight(0xffffff,0.30); rim.position.set(0,3,-3);
  scene.add(hemi,key,fill,rim);

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0,1,0);
}

async function loadRig(){
  const loader = new FBXLoader();
  const url = FBX_BASE + encodeURIComponent(RIG_FILE);
  const fbx = await loader.loadAsync(url);
  fbx.scale.setScalar(1);
  fbx.position.set(0,0,0);

  // Find jaw (support many naming variants) + collect morph targets
  fbx.traverse(o=>{
    if (o.isMesh) {
      // allow fade
      if (o.material){ o.material.transparent=true; o.material.opacity=1; }
      if (o.morphTargetDictionary){
        for (const key in o.morphTargetDictionary){
          if (/jaw|mouth|open/i.test(key)){
            mouthMorphTargets.push({mesh:o, key, idx:o.morphTargetDictionary[key]});
          }
        }
      }
    }
    if (o.isBone){
      const n = o.name.toLowerCase();
      if (/(^|_)jaw(_|$)/.test(n) || /mixamorigjaw/.test(n) || /head_jaw|jaw_joint/.test(n)) jawBone = o;
      // As a last resort, allow head as subtle pivot (tiny motion)
      if (!jawBone && /(^|_)head(_|$)|mixamorighead/.test(n)) jawBone = o;
    }
  });

  scene.add(fbx);
  model = fbx;
  mixer = new THREE.AnimationMixer(model);

  // Autoframe
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/1.5, size/2.5, size/1.5)));
  camera.lookAt(center);
  controls.target.copy(center);
  return model;
}

// (Optional) apply your real textures here by mesh name if needed
function applyUserMaterials(o){ /* hook for later if you want texture maps */ }

// ---------- ANIMATION ----------
async function loadClip(name){
  if (cache[name]) return cache[name];
  const loader = new FBXLoader();
  const url = FBX_BASE + encodeURIComponent(name) + ".fbx";
  const fbx = await loader.loadAsync(url);
  const clip = fbx.animations[0];
  cache[name] = clip;
  return clip;
}

async function play(name, loop=THREE.LoopRepeat, fade=0.35){
  if (!mixer) return;
  const clip = await loadClip(name);
  if (!clip) return;
  const action = mixer.clipAction(clip);
  action.reset(); action.setLoop(loop, Infinity);
  if (currentAction && currentAction!==action) currentAction.crossFadeTo(action, fade, false);
  action.play(); currentAction = action; lastAnimName = name;
  console.log("🤠 Bob action:", name);
}

// ---------- BRAIN ----------
let idleTimer=null;
function scheduleIdleCycle(){
  clearTimeout(idleTimer);
  const delay = rand(IDLE_MIN_MS, IDLE_MAX_MS);
  idleTimer = setTimeout(async ()=>{
    if (isSleeping || isWalkingAway){ scheduleIdleCycle(); return; }
    const r = Math.random();
    if (r < 0.10) await goSleepRandom();
    else if (r < 0.25) await walkAwayAndReturn();
    else if (r < 0.40) await doDanceRandom();
    else await randomIdle();
    scheduleIdleCycle();
  }, delay);
}

async function randomIdle(){
  const name = choice(ANIMS.idle, lastAnimName);
  await play(name);
  maybeSay(QUIPS.idle);
}

async function goSleepRandom(){
  isSleeping = true;
  const name = choice(ANIMS.sleep, lastAnimName);
  await play(name);
  maybeSay(QUIPS.sleep);
}

async function wakeUpRandom(){
  if (!isSleeping) return;
  isSleeping = false;
  const wake = choice(["Waking","Yelling Out","Talking"]);
  await play(wake, THREE.LoopOnce);
  setTimeout(()=>play("Neutral Idle"), 1200);
  maybeSay(QUIPS.return);
}

async function doDanceRandom(){
  const name = choice(["Silly Dancing","Walkingsneakily","Laughing"], lastAnimName);
  await play(name);
  maybeSay(QUIPS.dance);
}

async function waveHello(){ await play("Waving", THREE.LoopOnce); }
async function talkBit(){ await play("Talking"); maybeSay(QUIPS.talk); }
async function yellBit(){ await play("Yelling Out", THREE.LoopOnce); maybeSay(QUIPS.yell); }

async function walkAwayAndReturn(){
  isWalkingAway = true;
  await play(choice(["Walking","Walkingsneakily"], lastAnimName));
  maybeSay(QUIPS.walkAway);

  const start = performance.now();
  const startZ = model.position.z;
  const startScale = model.scale.x;
  const targetZ = WALK_AWAY_Z, targetScale = SCALE_MIN;
  const dur = Math.abs((targetZ-startZ)/WALK_SPEED)*1000;

  await new Promise(res=>{
    function step(t){
      const k = Math.min(1,(t-start)/dur);
      model.position.z = startZ + (targetZ-startZ)*k;
      const s = startScale + (targetScale-startScale)*k;
      model.scale.setScalar(s);
      setModelOpacity(1 - 0.7*k);
      if (k<1) requestAnimationFrame(step); else res();
    }
    requestAnimationFrame(step);
  });

  await new Promise(r=>setTimeout(r, 900));
  maybeSay(QUIPS.return);
  await play(choice(["Walking","Walkinglikezombie"], lastAnimName));

  const backStart = performance.now();
  await new Promise(res=>{
    function step(t){
      const k = Math.min(1,(t-backStart)/dur);
      model.position.z = targetZ + (0-targetZ)*k;
      const s = targetScale + (1-targetScale)*k;
      model.scale.setScalar(s);
      setModelOpacity(0.3 + 0.7*k);
      if (k<1) requestAnimationFrame(step); else res();
    }
    requestAnimationFrame(step);
  });

  isWalkingAway = false;
  await play("Neutral Idle");
}

function setModelOpacity(alpha){
  model.traverse(o=>{
    if (o.isMesh && o.material){
      if (Array.isArray(o.material)) o.material.forEach(m=>{m.transparent=true;m.opacity=alpha;});
      else { o.material.transparent=true; o.material.opacity=alpha; }
    }
  });
}

// ---------- QUIPS & VOICE ----------
const QUIPS = {
  idle:  [
    "Ain't much stirrin' out here.",
    "Wind's colder than a ghost's breath.",
    "Reckon I'll stretch these old bones.",
    "Just keepin' watch, partner.",
    "Time moves slower than molasses."
  ],
  dance: ["Y'all ain't ready for this two-step!","Watch these bones boogie!","I got rhythm for days.","Dust off them boots!"],
  sleep: ["Gonna catch me a quick shut-eye.","Dreamin' of tumbleweeds and campfires.","Wake me if the coyotes start singin'."],
  walkAway: ["Hold yer horses, be right back!","I'm moseyin' on for a spell.","Don't go nowhere now!"],
  return: ["Comin' on back, partner!","Miss me?","Well, I'll be—did ya call?"],
  talk:   ["Well now, partner, here's a tall tale.","Listen up, this won't take long.","Speak plain and I'll do the same."],
  wave:   ["Howdy there!","Tip o’ the hat to ya!","Good to see ya!"],
  yell:   ["Yeehaw!","Whooo-eee!","Heads up!"]
};

let recognition=null, speaking=false, jawPhase=0, selectedVoice=null;

function pickVoice(){
  const voices = window.speechSynthesis?.getVoices?.() || [];
  // Prefer names containing "Onyx" if available; else deep male-ish
  const onyx = voices.find(v => /onyx/i.test(v.name));
  if (onyx) return onyx;
  const deep = voices.find(v => /(male|baritone|bass|english)/i.test(`${v.name} ${v.lang}`));
  return deep || voices[0] || null;
}

function sayRandom(arr){
  if (!window.speechSynthesis || !arr?.length) return;
  const phrase = choice(arr);
  const u = new SpeechSynthesisUtterance(phrase);
  // Try to use Onyx + “filters and slowed”: slower rate, slightly lower pitch
  selectedVoice = selectedVoice || pickVoice();
  if (selectedVoice) u.voice = selectedVoice;
  u.rate = 0.85;   // slowed
  u.pitch = 0.9;   // a touch deeper
  u.volume = 1.0;
  u.onstart = ()=>{ speaking=true; console.log("💬 Bob said:", phrase); };
  u.onend   = ()=>{ speaking=false; closeMouth(); };
  // brief delay to avoid clipping with action crossfades
  setTimeout(()=>speechSynthesis.speak(u), 120);
}

function maybeSay(arr){ if (Math.random() < 0.55) sayRandom(arr); }

function closeMouth(){
  if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, 0, 0.7);
  mouthMorphTargets.forEach(({mesh, idx}) => { mesh.morphTargetInfluences[idx] = 0; });
}

function updateJaw(dt){
  if (!speaking) return;
  jawPhase += dt*6 + Math.random()*0.5;
  const open = 0.08 + 0.06*Math.abs(Math.sin(jawPhase));
  if (jawBone) jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, open, 0.5);
  mouthMorphTargets.forEach(({mesh, idx})=>{
    const cur = mesh.morphTargetInfluences[idx] || 0;
    mesh.morphTargetInfluences[idx] = THREE.MathUtils.lerp(cur, open*6, 0.5);
  });
}

// ---------- SPEECH RECOGNITION ----------
function initSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ console.warn("⚠️ SpeechRecognition unavailable — running silent mode."); return; }
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (e)=>{
    const idx = e.resultIndex;
    const transcript = (e.results[idx]?.[0]?.transcript || "").toLowerCase().trim();
    console.log("🗣️ You said:", `"${transcript}"`);
    handleCommand(transcript);
  };
  recognition.onerror = (ev)=>{ console.warn("⚠️ Speech error:", ev.error); };
  recognition.onend = ()=>{ try { recognition.start(); } catch {} };
  try { recognition.start(); console.log("🟢 Bob: Listening..."); } catch (e) {}
}

function handleCommand(txt){
  if (/hey\s*bob/.test(txt)){ wakeUpRandom(); return; }
  if (/dance|boogie|move it/.test(txt)){ doDanceRandom(); return; }
  if (/sleep|nap/.test(txt)){ goSleepRandom(); return; }
  if (/walk away|leave|go away/.test(txt)){ walkAwayAndReturn(); return; }
  if (/come back|return|back here/.test(txt)){ wakeUpRandom(); return; }
  if (/wave|hello/.test(txt)){ waveHello(); return; }
  if (/talk|speak|say something/.test(txt)){ talkBit(); return; }
  if (/yell|shout/.test(txt)){ yellBit(); return; }
  // Unknown → small reaction
  play(choice(["Shrugging","Looking Around","Shaking Head No"], lastAnimName));
}

// ---------- CAMERA DRIFT ----------
function updateCamera(dt){
  if (!isWalkingAway && !isSleeping){
    const drift = 0.1*dt;
    controls.target.y = THREE.MathUtils.lerp(controls.target.y, 1.1 + Math.sin(performance.now()*0.0003)*0.05, 0.15);
    camera.position.x += Math.sin(performance.now()*0.0002)*drift;
    camera.position.z += Math.cos(performance.now()*0.0002)*drift;
  }
  controls.update();
}

// ---------- MAIN LOOP ----------
function animate(){
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  updateJaw(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ---------- BOOT ----------
(async ()=>{
  try{
    if (typeof window.FBXLoader==="undefined" && window.THREE && THREE.FBXLoader){ window.FBXLoader = THREE.FBXLoader; }
    if (typeof THREE==="undefined" || typeof FBXLoader==="undefined") throw new Error("THREE/FBXLoader missing");
    initThree();
    await loadRig();
    await play("Neutral Idle");
    scheduleIdleCycle();
    // Voice synthesis voices can be async to load; pre-warm list:
    if (window.speechSynthesis){
      window.speechSynthesis.onvoiceschanged = ()=>{ selectedVoice = pickVoice(); };
      selectedVoice = pickVoice();
    }
    initSpeech();
    animate();
  }catch(e){
    console.error(e);
    showWarnBadge(); // subtle only
  }
})();
