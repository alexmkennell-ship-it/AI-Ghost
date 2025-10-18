console.log("🟢 Booting Bob (v5.5 GitHub Edition)…");

// ---------- CONFIG ----------
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const TEX_URL    = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

// ---------- FBXLoader Patch ----------
if (typeof window.FBXLoader === "undefined" && window.THREE && THREE.FBXLoader) {
  window.FBXLoader = THREE.FBXLoader;
  console.log("🧩 FBXLoader patched to global scope.");
}
if (typeof THREE === "undefined" || typeof FBXLoader === "undefined")
  throw new Error("❌ THREE.js or FBXLoader missing.");

// ---------- UTILS ----------
const setStatus = (m)=>document.getElementById("status").textContent=m;
const sleepMs = (ms)=>new Promise(r=>setTimeout(r,ms));
const pick = (a)=>a[Math.floor(Math.random()*a.length)];

// ---------- GLOBALS ----------
let scene,camera,renderer,clock,mixer,model,currentAction;
let state="boot",usingFallback=false;
const cam={radius:3,yaw:0,pitch:0.4,drift:false,target:new THREE.Vector3(0,1,0)};
const fallbackClips={},cache={};

// ---------- INIT ----------
function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,100);
  camera.position.set(0,1.6,3);

  const hemi=new THREE.HemisphereLight(0xffffff,0x444444,0.9);
  const dir=new THREE.DirectionalLight(0xffffff,0.8);
  dir.position.set(2,4,3);
  scene.add(hemi,dir);

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });

  // optional orbit controls
  const controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.target.copy(cam.target);
  controls.update();
}

// ---------- MODEL LOAD ----------
async function loadModel(){
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE+"Neutral Idle.fbx");
  fbx.scale.setScalar(1);            // correct size
  fbx.position.set(0,0,0);
  scene.add(fbx);
  model=fbx;

  const tex=await new THREE.TextureLoader().loadAsync(TEX_URL);
  tex.flipY=false;

  fbx.traverse(o=>{
    if(o.isMesh){
      o.material.map=tex;
      o.material.needsUpdate=true;
    }
  });

  mixer=new THREE.AnimationMixer(model);

  // auto-fit camera
  const box=new THREE.Box3().setFromObject(model);
  const size=box.getSize(new THREE.Vector3()).length();
  const center=box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/2,size/3,size/2)));
  camera.lookAt(center);

  return model.animations?.[0]??null;
}

// ---------- ANIMATION ----------
async function loadClip(name){
  if(cache[name])return cache[name];
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE+name+".fbx");
  const clip=fbx.animations[0];
  cache[name]=clip;
  return clip;
}
async function play(name){
  if(!mixer)return;
  const clip=await loadClip(name);
  if(!clip)return;
  const action=mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat,Infinity);
  if(currentAction)currentAction.crossFadeTo(action,0.4,false);
  action.play();
  currentAction=action;
}

// ---------- CAMERA + LOOP ----------
function updateCamera(){
  const r=cam.radius,y=cam.pitch,xz=r*Math.cos(y);
  camera.position.set(cam.target.x+xz*Math.sin(cam.yaw),
                      cam.target.y+r*Math.sin(y),
                      cam.target.z+xz*Math.cos(cam.yaw));
  camera.lookAt(cam.target);
}
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  mixer?.update(dt);
  updateCamera();
  renderer.render(scene,camera);
}

// ---------- AUDIO-CLICK UNLOCK ----------
document.body.addEventListener("click",()=>{
  if(state==="boot"){ state="idle"; setStatus("👂 Listening..."); }
},{once:true});

// ---------- BOOT ----------
async function boot(){
  setStatus("Initializing Bob...");
  initThree();

  try{ await loadModel(); }
  catch(err){ console.error(err); setStatus("⚠️ Failed to load FBX."); return; }

  await play("Neutral Idle");
  animate();
  state="idle";
  setStatus("👂 Listening...");
}

boot().catch(e=>{console.error(e);setStatus("❌ Load error.");});
