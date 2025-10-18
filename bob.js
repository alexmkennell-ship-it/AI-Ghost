/* Autonomous Bob v8.0 — solid look, wake-word sleep, phrase filter chat, mic-mute TTS
   Worker routes used:
     TTS  -> https://ghostaiv1.alexmkennell.workers.dev/tts
     Chat -> https://ghostaiv1.alexmkennell.workers.dev/
*/
console.log("🟢 Bob v8.0 init");

// ====== CONFIG ======
const FBX_BASE    = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE    = "T-Pose.fbx"; // loaded only for skeleton/mesh (no posing)
const WORKER_TTS  = "https://ghostaiv1.alexmkennell.workers.dev/tts";
const WORKER_CHAT = "https://ghostaiv1.alexmkennell.workers.dev/";

// Camera feel
const CAMERA_ANCHOR = new THREE.Vector3(0, 1.6, 4);
const DRIFT_RADIUS  = 0.12;
const RECENTER_EASE = 0.06;
const DRIFT_RETURN_MS = 11000;

// Animations available (all but T-Pose)
const ANIMS = [
  "Neutral Idle","Breathing Idle","Idle","Bored","Looking Around","Lying Down","Sleeping Idle","Sleeping Idle (1)",
  "Waking","Silly Dancing","Walkingsneakily","Walking","Walkinglikezombie","Stop Walking",
  "Waving","Shaking Head No","Shrugging","Talking","Laughing","Defeated","Sad Idle","Yelling Out","Waking","Waking","Waking"
];

// ====== GLOBALS ======
let scene, camera, renderer, clock, mixer, model, currentAction, controls;
let jawBone = null, mouthMorphTargets = [];
let isSleeping = false, isSpeaking = false;
let recognition = null, lastResultAt = 0;
const cache = Object.create(null);

// ====== HELPERS ======
function choice(arr, avoid){ if(!arr?.length) return ""; const f = avoid ? arr.filter(a=>a!==avoid) : arr; return f[Math.floor(Math.random()*f.length)] || arr[0]; }
function showWarnBadge(){ if (document.getElementById("bob-warn")) return; const b=document.createElement("div"); b.id="bob-warn"; b.textContent="⚠️"; b.style.cssText="position:fixed;top:10px;right:10px;font-size:24px;z-index:9999;user-select:none;"; document.body.appendChild(b); }
function validPhrase(str){
  if(!str) return false;
  // reject if mostly noise or < 3 solid words
  const words = (str.toLowerCase().match(/\b[a-z]{3,}\b/g) || []).length;
  return words >= 3;
}
function contains(txt, pattern){ return pattern.test(txt); }

// ====== THREE INIT ======
function initThree(){
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace; else renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.copy(CAMERA_ANCHOR);

  // three-point lighting with subtle cool rim
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  const key  = new THREE.DirectionalLight(0xffffff, 0.6); key.position.set(2,4,3);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-2,2,-2);
  const rim  = new THREE.DirectionalLight(0xaaffff, 0.35); rim.position.set(-3,4,-2);
  scene.add(hemi, key, fill, rim);

  clock = new THREE.Clock();

  window.addEventListener("resize",()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableRotate = controls.enableZoom = controls.enablePan = false;
  controls.target.set(0,1,0);
}

// ====== MATERIAL: solid, detailed (minimal ghosting) ======
function makeSolidBoneMaterial(){
  return new THREE.MeshPhysicalMaterial({
    color: 0xEAE7E2,              // bone-ish base
    emissive: new THREE.Color(0x99FFF0),
    emissiveIntensity: 0.015,     // faint shimmer only
    transparent: true,
    opacity: 0.88,                // solid visibility
    roughness: 0.45,
    metalness: 0.03,
    reflectivity: 0.12,
    clearcoat: 0.08,
    transmission: 0.0,            // no see-through
    thickness: 0.2,
    depthWrite: true,
    blending: THREE.NormalBlending
  });
}

// ====== LOAD RIG ======
async function loadRig(){
  const loader = new FBXLoader();
  const url    = FBX_BASE + encodeURIComponent(RIG_FILE);
  const fbx    = await loader.loadAsync(url);
  fbx.scale.setScalar(1);

  fbx.traverse(o=>{
    if (o.isMesh){
      o.material = makeSolidBoneMaterial();
      if (o.morphTargetDictionary){
        for (const k in o.morphTargetDictionary){
          if (/jaw|mouth|open/i.test(k)){
            mouthMorphTargets.push({ mesh:o, idx:o.morphTargetDictionary[k] });
          }
        }
      }
    }
    if (o.isBone){
      const n = o.name.toLowerCase();
      if (/jaw/.test(n)) jawBone = o;
      if (!jawBone && /head/.test(n)) jawBone = o;
    }
  });

  scene.add(fbx);
  model = fbx;
  mixer = new THREE.AnimationMixer(model);

  // fit camera
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/1.6, size/2.7, size/1.6)));
  controls.target.copy(center);
  camera.lookAt(center);

  return model;
}

// ====== ANIMATIONS ======
async function loadClip(name){
  if (cache[name]) return cache[name];
  const l = new FBXLoader();
  const f = await l.loadAsync(FBX_BASE + encodeURIComponent(name) + ".fbx");
  cache[name] = f.animations[0];
  return cache[name];
}
async function play(name, loop=THREE.LoopRepeat, fade=0.35){
  if (!mixer) return;
  const clip = await loadClip(name);
  if (!clip) return;
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop, Infinity);
  if (currentAction && currentAction !== action) currentAction.crossFadeTo(action, fade, false);
  action.play();
  currentAction = action;
  console.log("🤠 Bob action:", name);
}

// ====== TTS (mic muted while speaking) ======
async function say(text){
  if (!text) return;
  console.log("💬 Bob says:", text);
  try{
    isSpeaking = true;
    if (recognition) recognition.stop(); // pause listening

    const r = await fetch(WORKER_TTS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "onyx" })
    });
    if (!r.ok) throw new Error(await r.text());
    const b = await r.blob();
    const a = new Audio(URL.createObjectURL(b));
    a.volume = 0.9;

    // start jaw flapping during playback
    a.onplay  = ()=>{ speakingJawEnable(true); };
    a.onended = ()=>{
      speakingJawEnable(false);
      isSpeaking = false;
      try { recognition?.start(); } catch {}
    };
    await a.play();
  }catch(e){
    console.warn("⚠️ /tts failed:", e);
    speakingJawEnable(false);
    isSpeaking = false;
    try { recognition?.start(); } catch {}
  }
}

// ====== CHAT (AI reply to any valid phrase when awake) ======
async function askBob(prompt){
  try{
    const r = await fetch(WORKER_CHAT, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ prompt })
    });
    const j = await r.json();
    await say(j.reply || "Well shoot, reckon I'm tongue-tied.");
  }catch(e){
    console.warn("⚠️ Chat error:", e);
  }
}

// ====== BEHAVIORS ======
async function randomIdle(){
  const pick = choice(["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around"], (currentAction && currentAction._clip?.name));
  await play(pick);
}
async function goSleep(){
  isSleeping = true;
  await play(choice(["Sleeping Idle","Lying Down"]));
  await say(choice(["Gonna catch me a quick shut-eye.","Dreamin' of tumbleweeds."]));
}
async function wakeUp(){
  if (!isSleeping) return;
  isSleeping = false;
  await play("Waking", THREE.LoopOnce);
  setTimeout(()=>play("Neutral Idle"), 1200);
  await say(choice(["Mornin', partner.","Comin' back to it!"]));
}
async function doDance(){ await play(choice(["Silly Dancing","Walkingsneakily"])); await say(choice(["Watch these bones boogie!","Dust off them boots!"])); }
async function waveHello(){ await play("Waving", THREE.LoopOnce); await say("Howdy there!"); }
async function yellBit(){ await play("Yelling Out", THREE.LoopOnce); await say(choice(["Yee-haw!","Whooo-eee!"])); }
async function walkAwayAndReturn(){
  await play("Walking");
  await say("Hold yer horses—be right back!");
  const dur = 2000, start = performance.now();
  await new Promise(res=>{
    function step(t){ const k = Math.min(1, (t-start)/dur);
      model.position.z = 8 * k;
      model.scale.setScalar(1 - 0.75*k);
      requestAnimationFrame(k<1 ? step : res);
    } requestAnimationFrame(step);
  });
  await new Promise(r=>setTimeout(r, 700));
  await say("Comin' on back, partner!");
  await play("Walkinglikezombie");
  model.position.set(0,0,0);
  model.scale.setScalar(1);
  await play("Neutral Idle");
}

// ====== SPEECH RECOGNITION ======
function initSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ console.warn("SpeechRecognition unavailable"); return; }

  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = true;

  recognition.onresult = (e)=>{
    if (isSpeaking) return; // ignore our own voice
    const res = e.results[e.resultIndex][0];
    const txt = (res.transcript || "").toLowerCase().trim();
    lastResultAt = performance.now();
    console.log(`🗣️ You said: "${txt}"`);

    if (isSleeping){
      // Sleep gate: only wake phrase works
      if (/hey\s*bob/.test(txt)) { wakeUp(); }
      return;
    }

    // Awake: accept any valid phrase (>=3 words) → chat
    // But still allow keyword animations if user asks
    if (/dance|boogie|move/.test(txt)) { doDance(); return; }
    if (/sleep|nap|rest/.test(txt)) { goSleep(); return; }
    if (/walk away|leave|go away/.test(txt)) { walkAwayAndReturn(); return; }
    if (/come back|return|over here/.test(txt)) { wakeUp(); return; }
    if (/wave|hello|hi\b/.test(txt)) { waveHello(); return; }
    if (/yell|shout/.test(txt)) { yellBit(); return; }

    if (validPhrase(txt)) {
      // general conversation via worker
      askBob(txt);
    } else {
      // discard background fragments silently
    }
  };

  recognition.onend = ()=>{ if (!isSpeaking) { try { recognition.start(); } catch {} } };
  recognition.start();
  console.log("🟢 Bob: Listening...");
}

// ====== CAMERA DRIFT ======
let driftStart = performance.now();
function updateCamera(){
  const t = performance.now(), age = t - driftStart, ph = t*0.00022;
  const offX = Math.sin(ph) * DRIFT_RADIUS, offZ = Math.cos(ph*0.9) * DRIFT_RADIUS;
  const rec  = Math.min(1, age / DRIFT_RETURN_MS);
  const ease = RECENTER_EASE + rec*0.02;

  camera.position.lerp(new THREE.Vector3(CAMERA_ANCHOR.x + offX, CAMERA_ANCHOR.y, CAMERA_ANCHOR.z + offZ), 0.05);
  camera.position.lerp(CAMERA_ANCHOR, ease);
  controls.target.lerp(new THREE.Vector3(0,1,0), 0.08);
  controls.update();

  if (age > DRIFT_RETURN_MS*1.15) driftStart = t;
}
setInterval(()=>{
  camera.position.lerp(CAMERA_ANCHOR, 0.18);
  controls.target.lerp(new THREE.Vector3(0,1,0), 0.18);
  controls.update();
}, 42000);

// ====== JAW MOVE WHILE SPEAKING ======
let jawEnabled = false, jawPhase = 0;
function speakingJawEnable(v){ jawEnabled = v; if (!v){ resetJaw(); } }
function resetJaw(){
  if (jawBone) jawBone.rotation.x = 0;
  mouthMorphTargets.forEach(({mesh,idx})=>{ if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = 0; });
}
function jawTick(dt){
  if (!jawEnabled) return;
  jawPhase += dt * 10; // speed
  const amp = 0.2 + 0.1 * Math.sin(jawPhase*0.5); // subtle variation
  const open = Math.max(0, Math.sin(jawPhase)) * amp;

  if (jawBone) jawBone.rotation.x = open * 0.35; // rotate jaw bone a bit
  mouthMorphTargets.forEach(({mesh,idx})=>{
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = open;
  });
}

// ====== LOOP ======
function animate(){
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  mixer?.update(dt);
  jawTick(dt);
  updateCamera();
  renderer.render(scene, camera);
}

// ====== BOOT ======
(async ()=>{
  try{
    if (typeof window.FBXLoader === "undefined" && window.THREE && THREE.FBXLoader) window.FBXLoader = THREE.FBXLoader;
    if (typeof THREE === "undefined" || typeof FBXLoader === "undefined") throw new Error("THREE/FBXLoader missing");

    initThree();
    await loadRig();
    await play("Neutral Idle");

    // unlock audio on first click (browsers require user gesture)
    window.addEventListener("click", ()=>{ const s=new Audio(); s.play().catch(()=>{}); }, { once:true });

    initSpeech();
    animate();
  }catch(e){
    console.error(e);
    showWarnBadge();
  }
})();
