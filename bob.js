/* Bob v8.3 — True Cowboy (glossy)
   - Procedural color by height (no mesh names needed)
   - Warm realistic palette + AO-like joint shading + soft rim
   - Glossy look: lower roughness, clearcoat, sheen
   - All voice/anim features retained (uses your Worker)
*/
console.log("🟢 Bob v8.3 init");

const FBX_BASE    = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const RIG_FILE    = "T-Pose.fbx";
const WORKER_TTS  = "https://ghostaiv1.alexmkennell.workers.dev/tts";
const WORKER_CHAT = "https://ghostaiv1.alexmkennell.workers.dev/";

const CAMERA_ANCHOR   = new THREE.Vector3(0,1.6,4);
const DRIFT_RADIUS    = 0.12;
const RECENTER_EASE   = 0.06;
const DRIFT_RETURN_MS = 11000;

const ANIMS = [
  "Neutral Idle","Breathing Idle","Idle","Bored","Looking Around",
  "Lying Down","Sleeping Idle","Sleeping Idle (1)","Waking",
  "Silly Dancing","Walkingsneakily","Walking","Walkinglikezombie","Stop Walking",
  "Waving","Shaking Head No","Shrugging","Talking","Laughing",
  "Defeated","Sad Idle","Yelling Out"
];

let scene, camera, renderer, clock, mixer, model, currentAction, controls;
let jawBone=null, mouthMorphTargets=[];
let isSleeping=false, isSpeaking=false;
let recognition=null;
const cache = Object.create(null);

let audioUnlocked=false;
function unlockAudioOnce(){
  if (audioUnlocked) return;
  audioUnlocked = true;
  try{ const C = new (window.AudioContext||window.webkitAudioContext)();
       const b = C.createBuffer(1,1,22050), s=C.createBufferSource();
       s.buffer=b; s.connect(C.destination); s.start(0);}catch{}
}

function choice(arr, avoid){ if(!arr?.length) return ""; const f=avoid?arr.filter(a=>a!==avoid):arr; return f[Math.floor(Math.random()*f.length)]||arr[0]; }
function showWarnBadge(){ if(document.getElementById("bob-warn"))return; const d=document.createElement("div"); d.id="bob-warn"; d.textContent="⚠️"; d.style.cssText="position:fixed;top:10px;right:10px;font-size:24px;z-index:9999;user-select:none;"; document.body.appendChild(d); }
function validPhrase(s){ if(!s) return false; const w=(s.toLowerCase().match(/\b[a-z]{3,}\b/g)||[]).length; return w>=3; }

function initThree(){
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  if ("outputColorSpace" in renderer) renderer.outputColorSpace=THREE.SRGBColorSpace; else renderer.outputEncoding=THREE.sRGBEncoding;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.copy(CAMERA_ANCHOR);

  const hemi=new THREE.HemisphereLight(0xffffff,0x404040,0.55);
  const key =new THREE.DirectionalLight(0xffffff,0.66); key.position.set(2.2,4.2,3.0);
  const fill=new THREE.DirectionalLight(0xffffff,0.30); fill.position.set(-2.2,2.0,-2.6);
  const rim =new THREE.DirectionalLight(0x9fffe0,0.28); rim.position.set(-3.2,4.0,-2.0);
  scene.add(hemi,key,fill,rim);

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableRotate = controls.enableZoom = controls.enablePan = false;
  controls.target.set(0,1,0);

  window.addEventListener("pointerdown", unlockAudioOnce, { once:true });
  window.addEventListener("keydown",      unlockAudioOnce, { once:true });
}

// ---- Realistic warm palette ----
const C = {
  bone:   new THREE.Color(0xE8E2D2), // warm ivory
  hat:    new THREE.Color(0x6E4625), // deep brown leather
  shirt:  new THREE.Color(0x6B6A3F), // sun-faded olive
  denim:  new THREE.Color(0x3F6A8F), // mid denim blue
  boots:  new THREE.Color(0x6A4B2A)  // weathered tan
};
function lerpColor(out,a,b,t){ return out.copy(a).lerp(b, THREE.MathUtils.clamp(t,0,1)); }

// Apply per-vertex colors by height; glossy physical material with AO-ish darkening + soft rim
function applyGradientMaterial(mesh, bounds){
  const geom = mesh.geometry;
  if (!geom || !geom.attributes?.position) return;
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.attributes.position;
  const vCount = pos.count;

  const minY=bounds.min.y, maxY=bounds.max.y, rangeY=Math.max(1e-6, maxY-minY);
  const colors = new Float32Array(vCount*3);
  const tmp = new THREE.Color();

  for (let i=0;i<vCount;i++){
    const y = pos.getY(i);
    const t = (y - minY)/rangeY; // 0..1 feet→hat

    // tuned bands (no popsicle): boots(0-.34) → denim(.34-.62) → shirt(.62-.84) → hat(.84-1)
    if (t > 0.84){
      // top: hat → a hint of bone at crown
      lerpColor(tmp, C.hat, C.bone, (t-0.84)/0.16);
    } else if (t > 0.62){
      // shirt: olive fading toward denim at belt
      lerpColor(tmp, C.shirt, C.denim, (t-0.62)/0.20);
    } else if (t > 0.34){
      // denim solid
      tmp.copy(C.denim);
    } else {
      // boots fade up into bone at shin
      lerpColor(tmp, C.boots, C.bone, (t-0.00)/0.34);
    }

    colors[i*3+0]=tmp.r; colors[i*3+1]=tmp.g; colors[i*3+2]=tmp.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors,3));
  mesh.geometry = g;

  const m = new THREE.MeshPhysicalMaterial({
    vertexColors:true,
    roughness:0.35,           // glossier
    metalness:0.08,
    reflectivity:0.18,
    clearcoat:0.28,
    clearcoatRoughness:0.35,
    sheen:0.35,
    sheenColor:new THREE.Color(0xFFF2D8),
    transparent:false,
    transmission:0.0,
    thickness:0.25
  });

  m.onBeforeCompile = (shader)=>{
    shader.uniforms.fresnelColor = { value:new THREE.Color(0x9FFFE0) };
    shader.uniforms.fresnelPower = { value:2.0 };
    shader.uniforms.fresnelMix   = { value:0.08 };
    shader.uniforms.aoStrength   = { value:0.32 };

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
       uniform vec3  fresnelColor;
       uniform float fresnelPower;
       uniform float fresnelMix;
       uniform float aoStrength;
      `
    ).replace(
      '#include <output_fragment>',
      `
       // soft rim
       vec3 V = normalize(cameraPosition - vWorldPos);
       float f = pow(1.0 - max(0.0, dot(normalize(vWorldNormal), V)), fresnelPower);
       vec3 rim = fresnelColor * f * fresnelMix;

       // AO-like joint darkening using normal variation
       #ifdef GL_OES_standard_derivatives
         vec3 nrm = normalize(vWorldNormal);
         float curv = length(fwidth(nrm));
         float ao = clamp(curv * 1.6, 0.0, 1.0) * aoStrength;
       #else
         float ao = 0.0;
       #endif

       gl_FragColor.rgb = (gl_FragColor.rgb + rim) * (1.0 - ao);
       #include <output_fragment>
      `
    );
  };

  mesh.material = m;
}

async function loadRig(){
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE + encodeURIComponent(RIG_FILE));
  fbx.scale.setScalar(1);

  const bb = new THREE.Box3().setFromObject(fbx);

  fbx.traverse(o=>{
    if (o.isBone){
      const n=o.name.toLowerCase();
      if (/jaw/.test(n)) jawBone=o;
      if (!jawBone && /head/.test(n)) jawBone=o;
    }
    if (o.isMesh){
      if (o.morphTargetDictionary){
        for (const k in o.morphTargetDictionary){
          if (/jaw|mouth|open/i.test(k))
            mouthMorphTargets.push({ mesh:o, idx:o.morphTargetDictionary[k] });
        }
      }
      applyGradientMaterial(o, bb);
    }
  });

  scene.add(fbx);
  model=fbx;
  mixer=new THREE.AnimationMixer(model);

  const box=new THREE.Box3().setFromObject(model);
  const size=box.getSize(new THREE.Vector3()).length();
  const center=box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/1.65, size/2.8, size/1.65)));
  controls.target.copy(center);
  camera.lookAt(center);
  return model;
}

async function loadClip(name){
  if (cache[name]) return cache[name];
  const l=new FBXLoader();
  const f=await l.loadAsync(FBX_BASE + encodeURIComponent(name) + ".fbx");
  cache[name]=f.animations[0];
  return cache[name];
}
async function play(name, loop=THREE.LoopRepeat, fade=0.35){
  if (!mixer) return;
  const clip=await loadClip(name);
  if (!clip) return;
  const a=mixer.clipAction(clip);
  a.reset(); a.setLoop(loop, Infinity);
  if (currentAction && currentAction !== a) currentAction.crossFadeTo(a, fade, false);
  a.play(); currentAction=a;
  console.log("🤠 Bob action:", name);
}

async function say(text){
  if (!text) return;
  console.log("💬 Bob says:", text);
  try{
    if (!audioUnlocked) unlockAudioOnce();
    isSpeaking=true; if (recognition) recognition.stop();
    const r = await fetch(WORKER_TTS, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ text, voice:"onyx" }) });
    if (!r.ok) throw new Error(await r.text());
    const b=await r.blob(); const a=new Audio(URL.createObjectURL(b));
    a.volume=0.9; a.onplay=()=>speakingJawEnable(true);
    a.onended=()=>{ speakingJawEnable(false); isSpeaking=false; try{ recognition?.start(); }catch{} };
    await a.play();
  }catch(e){ console.warn("⚠️ /tts failed:", e); speakingJawEnable(false); isSpeaking=false; try{ recognition?.start(); }catch{} }
}

async function askBob(prompt){
  try{
    const r = await fetch(WORKER_CHAT, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ prompt })});
    const j = await r.json();
    await say(j.reply || "Well shoot, reckon I'm tongue-tied.");
  }catch(e){ console.warn("⚠️ Chat error:", e); }
}

async function randomIdle(){
  const pick=choice(["Neutral Idle","Breathing Idle","Idle","Bored","Looking Around"], (currentAction && currentAction._clip?.name));
  await play(pick);
}
async function goSleep(){
  isSleeping=true;
  await play(choice(["Sleeping Idle","Lying Down"]));
  await say(choice(["Gonna catch me a quick shut-eye.","Dreamin' o' tumbleweeds."]));
}
async function wakeUp(){
  if (!isSpeaking && isSleeping){
    isSleeping=false;
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
  model.position.set(0,0,0); model.scale.setScalar(1);
  await play("Neutral Idle");
}

function initSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ console.warn("SpeechRecognition unavailable"); return; }
  recognition = new SR();
  recognition.lang="en-US"; recognition.continuous=true;

  recognition.onresult=(e)=>{
    if (isSpeaking) return;
    const res=e.results[e.resultIndex][0];
    const txt=(res.transcript||"").toLowerCase().trim();
    console.log(`🗣️ You said: "${txt}"`);

    if (isSleeping){ if (/hey\s*bob/.test(txt)) wakeUp(); return; }

    if (/dance|boogie|move/.test(txt)) { doDance(); return; }
    if (/sleep|nap|rest/.test(txt)) { goSleep(); return; }
    if (/walk away|leave|go away/.test(txt)) { walkAwayAndReturn(); return; }
    if (/come back|return|over here/.test(txt)) { wakeUp(); return; }
    if (/wave|hello|hi\b/.test(txt)) { waveHello(); return; }
    if (/yell|shout/.test(txt)) { yellBit(); return; }

    if (validPhrase(txt)) askBob(txt);
  };
  recognition.onend = ()=>{ if (!isSpeaking) { try{ recognition.start(); }catch{} } };
  recognition.start();
  console.log("🟢 Bob: Listening...");
}

let driftStart=performance.now();
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

let jawEnabled=false, jawPhase=0;
function speakingJawEnable(v){ jawEnabled=v; if(!v) resetJaw(); }
function resetJaw(){
  if (jawBone) jawBone.rotation.x=0;
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

function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  mixer?.update(dt);
  jawTick(dt);
  updateCamera();
  renderer.render(scene,camera);
}

(async()=>{
  try{
    if (typeof window.FBXLoader==="undefined" && window.THREE && THREE.FBXLoader) window.FBXLoader=THREE.FBXLoader;
    if (typeof THREE==="undefined"||typeof FBXLoader==="undefined") throw new Error("THREE/FBXLoader missing");
    initThree();
    await loadRig();
    await play("Neutral Idle");
    window.addEventListener("click", unlockAudioOnce, { once:true });
    initSpeech();
    animate();
  }catch(e){ console.error(e); showWarnBadge(); }
})();
