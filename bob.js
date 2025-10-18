/* Autonomous Bob v8.2 — Spectral Cowboy Gradient Edition
   - Procedural gradient shading by height (hat/shirt/denim/boots/bone) — no per-mesh names required
   - Subtle rim/aura via Fresnel tweak
   - TTS autoplay fixed (user-gesture unlock)
   Worker routes:
     TTS  -> https://ghostaiv1.alexmkennell.workers.dev/tts
     Chat -> https://ghostaiv1.alexmkennell.workers.dev/
*/
console.log("🟢 Bob v8.2 init");

// ====== CONFIG ======
const FBX_BASE    = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE    = "T-Pose.fbx"; // rig/mesh only
const WORKER_TTS  = "https://ghostaiv1.alexmkennell.workers.dev/tts";
const WORKER_CHAT = "https://ghostaiv1.alexmkennell.workers.dev/";

// Camera feel
const CAMERA_ANCHOR   = new THREE.Vector3(0,1.6,4);
const DRIFT_RADIUS    = 0.12;
const RECENTER_EASE   = 0.06;
const DRIFT_RETURN_MS = 11000;

// Animations (all except T-Pose)
const ANIMS = [
  "Neutral Idle","Breathing Idle","Idle","Bored","Looking Around",
  "Lying Down","Sleeping Idle","Sleeping Idle (1)","Waking",
  "Silly Dancing","Walkingsneakily","Walking","Walkinglikezombie","Stop Walking",
  "Waving","Shaking Head No","Shrugging","Talking","Laughing",
  "Defeated","Sad Idle","Yelling Out"
];

// ====== GLOBALS ======
let scene, camera, renderer, clock, mixer, model, currentAction, controls;
let jawBone=null, mouthMorphTargets=[];
let isSleeping=false, isSpeaking=false;
let recognition=null;
const cache = Object.create(null);

// audio unlock
let audioUnlocked = false;
function unlockAudioOnce(){
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const b = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0);
  } catch {}
}

// ====== HELPERS ======
function choice(arr, avoid){ if(!arr?.length) return ""; const f=avoid?arr.filter(a=>a!==avoid):arr; return f[Math.floor(Math.random()*f.length)]||arr[0]; }
function showWarnBadge(){ if(document.getElementById("bob-warn"))return; const b=document.createElement("div"); b.id="bob-warn"; b.textContent="⚠️"; b.style.cssText="position:fixed;top:10px;right:10px;font-size:24px;z-index:9999;user-select:none;"; document.body.appendChild(b); }
function validPhrase(str){ if(!str) return false; const words=(str.toLowerCase().match(/\b[a-z]{3,}\b/g)||[]).length; return words>=3; }

// ====== THREE INIT ======
function initThree(){
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace; else renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.copy(CAMERA_ANCHOR);

  // balanced lighting + cool rim for subtle spectral feel
  const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.55);
  const key  = new THREE.DirectionalLight(0xffffff, 0.62); key.position.set(2.2,4.2,3.2);
  const fill = new THREE.DirectionalLight(0xffffff, 0.30); fill.position.set(-2.0,2.0,-2.5);
  const rim  = new THREE.DirectionalLight(0x9fffe0, 0.38); rim.position.set(-3.0,4.0,-2.0);
  scene.add(hemi, key, fill, rim);

  clock = new THREE.Clock();
  window.addEventListener("resize", ()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableRotate = controls.enableZoom = controls.enablePan = false;
  controls.target.set(0,1,0);

  // one-time click/tap unlock for autoplay
  window.addEventListener("pointerdown", unlockAudioOnce, { once:true });
  window.addEventListener("keydown", unlockAudioOnce, { once:true });
}

// ====== PROCEDURAL GRADIENT SHADING ======
// Colors (sRGB)
const C = {
  bone:   new THREE.Color(0xEAE7D8), // ivory
  hat:    new THREE.Color(0x7B4A24), // brown leather
  shirt:  new THREE.Color(0x7A6F4C), // olive drab
  denim:  new THREE.Color(0x496E9E), // muted blue
  boots:  new THREE.Color(0x5A3B1E), // dark tan
};
// Blend helper
function lerpColor(out, a, b, t){ return out.copy(a).lerp(b, THREE.MathUtils.clamp(t,0,1)); }

// Assign vertex colors by height bands; add Fresnel rim in shader
function applyGradientMaterial(mesh, bounds){
  const geom = mesh.geometry;
  if (!geom || !geom.attributes?.position) return;

  // ensure non-indexed for per-vertex colors
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.attributes.position;
  const vCount = pos.count;

  // y-normalization across model
  const minY = bounds.min.y, maxY = bounds.max.y, rangeY = Math.max(1e-6, maxY - minY);

  // vertex color buffer
  const colors = new Float32Array(vCount * 3);
  const temp = new THREE.Color();

  for (let i=0;i<vCount;i++){
    const y = pos.getY(i);
    const t = (y - minY) / rangeY; // 0..1 from feet to hat top
    // bands with soft blends
    if (t > 0.78){                         // Hat band (top)
      lerpColor(temp, C.hat, C.bone, (t-0.78)/0.22);
    } else if (t > 0.55){                  // Shirt / chest
      lerpColor(temp, C.shirt, C.denim, (t-0.55)/0.20);
    } else if (t > 0.28){                  // Denim mid
      lerpColor(temp, C.denim, C.denim, 0.0);
    } else {                               // Boots / lower bones
      lerpColor(temp, C.boots, C.bone, (t-0.00)/0.28);
    }
    colors[i*3+0] = temp.r;
    colors[i*3+1] = temp.g;
    colors[i*3+2] = temp.b;
  }

  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  mesh.geometry = g;

  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    transparent: false,
    roughness: 0.55,
    metalness: 0.04,
    reflectivity: 0.12,
    clearcoat: 0.06,
    transmission: 0.0,
    thickness: 0.2
  });

  // Subtle Fresnel rim tint (turquoise)
  m.onBeforeCompile = (shader)=>{
    shader.uniforms.fresnelColor = { value: new THREE.Color(0x9FFFE0) };
    shader.uniforms.fresnelPower = { value: 2.25 };
    shader.uniforms.fresnelMix   = { value: 0.10 };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWorldNormal;
       varying vec3 vWorldPos;
      `
    ).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec4 wPos = modelMatrix * vec4(transformed, 1.0);
       vWorldPos = wPos.xyz;
       vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWorldNormal;
       varying vec3 vWorldPos;
       uniform vec3 fresnelColor;
       uniform float fresnelPower;
       uniform float fresnelMix;
      `
    ).replace(
      '#include <output_fragment>',
      `
       // Fresnel rim
       vec3 V = normalize(cameraPosition - vWorldPos);
       float f = pow(1.0 - max(0.0, dot(normalize(vWorldNormal), V)), fresnelPower);
       vec3 rim = fresnelColor * f * fresnelMix;
       gl_FragColor = vec4(gl_FragColor.rgb + rim, gl_FragColor.a);
       #include <output_fragment>
      `
    );
  };

  mesh.material = m;
}

// ====== LOAD RIG & ASSIGN ======
async function loadRig(){
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync(FBX_BASE + encodeURIComponent(RIG_FILE));
  fbx.scale.setScalar(1);

  // compute global bounds first (for consistent y normalization)
  const bb = new THREE.Box3().setFromObject(fbx);

  fbx.traverse(o=>{
    // collect bones/morphs
    if (o.isBone){
      const n = o.name.toLowerCase();
      if (/jaw/.test(n)) jawBone = o;
      if (!jawBone && /head/.test(n)) jawBone = o;
    }
    if (o.isMesh){
      if (o.morphTargetDictionary){
        for (const k in o.morphTargetDictionary){
          if (/jaw|mouth|open/i.test(k))
            mouthMorphTargets.push({ mesh:o, idx:o.morphTargetDictionary[k] });
        }
      }
      // Apply gradient material regardless of mesh naming
      applyGradientMaterial(o, bb);
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

// ====== TTS (mic muted while speaking; uses unlock) ======
async function say(text){
  if (!text) return;
  console.log("💬 Bob says:", text);
  try{
    if (!audioUnlocked) unlockAudioOnce(); // just in case
    isSpeaking = true;
    if (recognition) recognition.stop(); // pause listening
    const r = await fetch(WORKER_TTS, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ text, voice:"onyx" })
    });
    if (!r.ok) throw new Error(await r.text());
    const b = await r.blob();
    const a = new Audio(URL.createObjectURL(b));
    a.volume = 0.9;
    a.onplay  = ()=>{ speakingJawEnable(true); };
    a.onended = ()=>{ speakingJawEnable(false); isSpeaking=false; try{ recognition?.start(); }catch{} };
    await a.play();
  }catch(e){
    console.warn("⚠️ /tts failed:", e);
    speakingJawEnable(false);
    isSpeaking=false; try{ recognition?.start(); }catch{}
  }
}

// ====== CHAT (AI reply for any valid phrase when awake) ======
async function askBob(prompt){
  try{
    const r = await fetch(WORKER_CHAT, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ prompt })
    });
    const j = await r.json();
    await say(j.reply || "Well shoot, reckon I'm tongue-tied.");
  }catch(e){ console.warn("⚠️ Chat error:", e); }
}

// ====== BEHAVIORS ======
async function randomIdle(){
  const pick = choice(["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around"], (currentAction && currentAction._clip?.name));
  await play(pick);
}
async function goSleep(){
  isSleeping = true;
  await play(choice(["Sleeping Idle","Lying Down"]));
  await say(choice(["Gonna catch me a quick shut-eye.","Dreamin' o' tumbleweeds."]));
}
async function wakeUp(){
  if (!isSpeaking && isSleeping){
    isSleeping = false;
    await play("Waking", THREE.LoopOnce);
    setTimeout(()=>play("Neutral Idle"), 1200);
    await say(choice(["Mornin', partner.","Comin' back to it!"]));
  }
}
async function doDance(){ await play(choice(["Silly Dancing","Walkingsneakily"])); await say(choice(["Watch these bones boogie!","Dust off them boots!"])); }
async function waveHello(){ await play("Waving", THREE.LoopOnce); await say("Howdy there!"); }
async function yellBit(){ await play("Yelling Out", THREE.LoopOnce); await say(choice(["Yee-haw!","Whooo-eee!"])); }
async function walkAwayAndReturn(){
  await play("Walking");
  await say("Hold yer horses—be right back!");
  const dur=2000, start=performance.now();
  await new Promise(res=>{
    function step(t){ const k=Math.min(1,(t-start)/dur);
      model.position.z = 8*k;
      model.scale.setScalar(1 - 0.75*k);
      requestAnimationFrame(k<1?step:res);
    } requestAnimationFrame(step);
  });
  await new Promise(r=>setTimeout(r,700));
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
    console.log(`🗣️ You said: "${txt}"`);

    if (isSleeping){
      if (/hey\s*bob/.test(txt)) { wakeUp(); }
      return;
    }

    // awake: keywords first
    if (/dance|boogie|move/.test(txt)) { doDance(); return; }
    if (/sleep|nap|rest/.test(txt)) { goSleep(); return; }
    if (/walk away|leave|go away/.test(txt)) { walkAwayAndReturn(); return; }
    if (/come back|return|over here/.test(txt)) { wakeUp(); return; }
    if (/wave|hello|hi\b/.test(txt)) { waveHello(); return; }
    if (/yell|shout/.test(txt)) { yellBit(); return; }

    // general phrase → AI chat
    if (validPhrase(txt)) askBob(txt);
  };

  recognition.onend = ()=>{ if (!isSpeaking) { try{ recognition.start(); }catch{} } };
  recognition.start();
  console.log("🟢 Bob: Listening...");
}

// ====== CAMERA DRIFT ======
let driftStart = performance.now();
function updateCamera(){
  const t=performance.now(), age=t-driftStart, ph=t*0.00022;
  const offX=Math.sin(ph)*DRIFT_RADIUS, offZ=Math.cos(ph*0.9)*DRIFT_RADIUS;
  const rec=Math.min(1, age/DRIFT_RETURN_MS);
  const ease=RECENTER_EASE + rec*0.02;

  camera.position.lerp(new THREE.Vector3(CAMERA_ANCHOR.x+offX, CAMERA_ANCHOR.y, CAMERA_ANCHOR.z+offZ), 0.05);
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

// ====== JAW MOTION ======
let jawEnabled=false, jawPhase=0;
function speakingJawEnable(v){ jawEnabled=v; if(!v) resetJaw(); }
function resetJaw(){
  if (jawBone) jawBone.rotation.x = 0;
  mouthMorphTargets.forEach(({mesh,idx})=>{
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx]=0;
  });
}
function jawTick(dt){
  if (!jawEnabled) return;
  jawPhase += dt*10;
  const amp = 0.2 + 0.1*Math.sin(jawPhase*0.5);
  const open = Math.max(0, Math.sin(jawPhase)) * amp;
  if (jawBone) jawBone.rotation.x = open * 0.35;
  mouthMorphTargets.forEach(({mesh,idx})=>{
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx]=open;
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
    if (typeof window.FBXLoader==="undefined" && window.THREE && THREE.FBXLoader) window.FBXLoader = THREE.FBXLoader;
    if (typeof THREE==="undefined" || typeof FBXLoader==="undefined") throw new Error("THREE/FBXLoader missing");

    initThree();
    await loadRig();
    await play("Neutral Idle");

    // user gesture unlock (guarantees autoplay)
    window.addEventListener("click", unlockAudioOnce, { once:true });

    initSpeech();
    animate();
  }catch(e){ console.error(e); showWarnBadge(); }
})();
