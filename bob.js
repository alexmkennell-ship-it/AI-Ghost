console.log("🟢 Booting Bob (v6.0 — Final Cowboy Edition)…");

// ---------- CONFIG ----------
const WORKER_URL = "https://ghostaiv1.alexmkennell.workers.dev";
const FBX_BASE   = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const TEX_URL    = `${FBX_BASE}Boney_Bob_the_skeleto_1017235951_texture.png`;

// ---------- VERIFY GLOBALS ----------
if (typeof window.FBXLoader === "undefined" && window.THREE && THREE.FBXLoader) {
  window.FBXLoader = THREE.FBXLoader;
  console.log("🧩 FBXLoader patched to global scope.");
}
if (typeof THREE === "undefined" || typeof FBXLoader === "undefined")
  throw new Error("❌ THREE.js or FBXLoader missing.");

// ---------- UTILS ----------
const setStatus = (m)=>document.getElementById("status").textContent=m;
const cache={};

// ---------- GLOBALS ----------
let scene,camera,renderer,clock,mixer,model,currentAction;
let state="boot";
const cam={radius:3.5,yaw:0,pitch:0.4,drift:false,target:new THREE.Vector3(0,1,0)};

// ---------- INIT ----------
function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,100);
  camera.position.set(0,1.6,4);

  // Soft 3-point lighting setup
  const hemi=new THREE.HemisphereLight(0xffffff,0x444444,0.45);
  const key =new THREE.DirectionalLight(0xffffff,0.55);
  key.position.set(2,4,3);
  const fill=new THREE.DirectionalLight(0xffffff,0.25);
  fill.position.set(-2,2,-2);
  const rim =new THREE.DirectionalLight(0xffffff,0.3);
  rim.position.set(0,3,-3);
  scene.add(hemi,key,fill,rim);

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });

  const controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.target.copy(cam.target);
  controls.update();
}

// ---------- MODEL LOAD ----------
async function loadModel(){
  const loader=new FBXLoader();

  // 🎯 Load base rig (your mesh only)
  const fbx=await loader.loadAsync(FBX_BASE+"T-Pose.fbx");
  fbx.scale.setScalar(1); // Mixamo FBXs are huge; scale down
  fbx.position.set(0,0,0);
  scene.add(fbx);
  model=fbx;

  // 🖌 Load and apply texture properly
  const tex=await new THREE.TextureLoader().loadAsync(TEX_URL);
  tex.flipY=false;
  tex.colorSpace = THREE.SRGBColorSpace;

  fbx.traverse(o=>{
    if(o.isMesh){
      o.material = new THREE.MeshLambertMaterial({
        map: tex,
        color: 0xffffff,
        side: THREE.DoubleSide
      });
      o.material.needsUpdate=true;
    }
  });

  mixer=new THREE.AnimationMixer(model);

  // Auto-fit camera
  const box=new THREE.Box3().setFromObject(model);
  const size=box.getSize(new THREE.Vector3()).length();
  const center=box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/1.5,size/2.5,size/1.5)));
  camera.lookAt(center);

  return model;
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

// ---------- AUDIO CLICK UNLOCK ----------
document.body.addEventListener("click",()=>{
  if(state==="boot"){ state="idle"; setStatus("👂 Listening..."); }
},{once:true});

// ---------- BOOT ----------
async function boot(){
  setStatus("Initializing Bob...");
  initThree();

  try{
    await loadModel();
    await play("Neutral Idle");
  } catch(err){
    console.error(err);
    setStatus("⚠️ Failed to load FBX or animation.");
    return;
  }

  animate();
  state="idle";
  setStatus("👂 Listening...");
}

boot().catch(e=>{console.error(e);setStatus("❌ Load error.");});
