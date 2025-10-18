console.log("🟢 Booting Bob (v6.1 — Procedural Stand-In)…");

// ---------- CONFIG ----------
const FBX_BASE = "https://pub-30bcc0b2a7044074a19efdef19f69857.r2.dev/models/";
const BASE_RIG  = "T-Pose.fbx";      // your Mixamo rig (no mesh needed)
const START_ANIM = "Neutral Idle";   // animation FBX name (without .fbx)

// ---------- VERIFY GLOBALS ----------
if (typeof window.FBXLoader === "undefined" && window.THREE && THREE.FBXLoader) {
  window.FBXLoader = THREE.FBXLoader;
  console.log("🧩 FBXLoader patched to global scope.");
}
if (typeof THREE === "undefined" || typeof FBXLoader === "undefined")
  throw new Error("❌ THREE.js or FBXLoader missing.");

// ---------- UTILS ----------
const setStatus = (m)=>document.getElementById("status").textContent=m;
const deg = (a)=>a*Math.PI/180;
const findBone = (root, names)=> {
  // Try several common Mixamo name variants
  const tries = (Array.isArray(names)?names:[names]).flatMap(n=>[
    n, `mixamorig:${n}`, `mixamorig_${n}`, n.replace(" ", "_")
  ]);
  let hit = null;
  root.traverse(o => {
    if (hit || !o.isBone) return;
    if (tries.some(t => o.name === t)) hit = o;
  });
  return hit;
};
const attachPart = (bone, mesh, opts={})=>{
  if (!bone || !mesh) return;
  mesh.position.set(0,0,0);
  mesh.rotation.set(0,0,0);
  mesh.scale.set(1,1,1);
  if (opts.pos) mesh.position.copy(opts.pos);
  if (opts.rot) mesh.rotation.set(opts.rot.x, opts.rot.y, opts.rot.z);
  if (opts.scl) mesh.scale.copy(opts.scl);
  bone.add(mesh);
  return mesh;
};

// ---------- GLOBALS ----------
let scene,camera,renderer,clock,mixer,rigRoot,currentAction;
const cache = {};
const cam={radius:3.5,yaw:0,pitch:0.38,drift:false,target:new THREE.Vector3(0,1.0,0)};

// ---------- INIT ----------
function initThree(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,100);
  camera.position.set(0,1.6,4);

  // Soft 3-point lighting
  const hemi=new THREE.HemisphereLight(0xffffff,0x2b2b2b,0.55);
  const key =new THREE.DirectionalLight(0xffffff,0.6); key.position.set(2,4,3);
  const fill=new THREE.DirectionalLight(0xffffff,0.28); fill.position.set(-2,1.8,-2);
  const rim =new THREE.DirectionalLight(0xffffff,0.22); rim.position.set(0,3,-3);
  scene.add(hemi,key,fill,rim);

  // Ground hint (very faint)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshStandardMaterial({color:0x0b0b0b, roughness:1, metalness:0})
  );
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -0.95;
  ground.receiveShadow = true;
  scene.add(ground);

  clock=new THREE.Clock();
  window.addEventListener("resize",()=>{
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  });

  // OrbitControls (r146 global)
  const controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.target.copy(cam.target);
  controls.update();
}

// ---------- MATERIAL PALETTE (matte, readable) ----------
const MAT = {
  bone:  new THREE.MeshStandardMaterial({ color:0xd9c7a0, metalness:0, roughness:1 }),
  denim: new THREE.MeshStandardMaterial({ color:0x3b6ca8, metalness:0, roughness:1 }),
  leather:new THREE.MeshStandardMaterial({ color:0x7b5e2b, metalness:0, roughness:0.95 }),
  boot:  new THREE.MeshStandardMaterial({ color:0x825c32, metalness:0, roughness:1 }),
  shirt: new THREE.MeshStandardMaterial({ color:0x7fa15a, metalness:0, roughness:0.95 }),
  strap: new THREE.MeshStandardMaterial({ color:0x5f4522, metalness:0, roughness:0.95 }),
  eye:   new THREE.MeshStandardMaterial({ color:0x2cff64, emissive:0x1ba844, emissiveIntensity:0.75, metalness:0, roughness:1 })
};

// ---------- PROCEDURAL PARTS ----------
function buildProceduralCowboy(root){
  // Helpful scale note:
  // Mixamo rigs are huge; we scale the entire rig to 0.01.
  // The local units below are tuned for that scale.

  const headB = findBone(root, ["Head"]);
  const neckB = findBone(root, ["Neck","Neck1"]);
  const spn2B = findBone(root, ["Spine2","Spine1"]);
  const spnB  = findBone(root, ["Spine","Spine1"]);
  const hipsB = findBone(root, ["Hips"]);
  const lUpLeg = findBone(root, ["LeftUpLeg"]);
  const rUpLeg = findBone(root, ["RightUpLeg"]);
  const lLeg = findBone(root, ["LeftLeg"]);
  const rLeg = findBone(root, ["RightLeg"]);
  const lFoot = findBone(root, ["LeftFoot"]);
  const rFoot = findBone(root, ["RightFoot"]);
  const lArm = findBone(root, ["LeftArm"]);
  const rArm = findBone(root, ["RightArm"]);
  const lFore = findBone(root, ["LeftForeArm"]);
  const rFore = findBone(root, ["RightForeArm"]);
  const lHand = findBone(root, ["LeftHand"]);
  const rHand = findBone(root, ["RightHand"]);

  // ---- Skull
  if (headB){
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 24), MAT.bone);
    attachPart(headB, skull, { pos:new THREE.Vector3(0,0.06,0) });

    // Jaw block (stylized)
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), MAT.bone);
    attachPart(headB, jaw, { pos:new THREE.Vector3(0,-0.015,0.03) });

    // Eyes (glowy)
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 16), MAT.eye);
    const eyeL = eyeR.clone();
    attachPart(headB, eyeR, { pos:new THREE.Vector3(0.035, 0.035, 0.06) });
    attachPart(headB, eyeL, { pos:new THREE.Vector3(-0.035, 0.035, 0.06) });

    // Hat (brim + crown)
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.16,0.02, 24), MAT.leather);
    brim.rotation.x = deg(0);
    attachPart(headB, brim, { pos:new THREE.Vector3(0,0.12,0) });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.11,0.11, 24), MAT.leather);
    attachPart(headB, crown, { pos:new THREE.Vector3(0,0.175,0) });
  }

  // ---- Torso (shirt + denim overalls bib)
  if (spnB){
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.15, 8, 16), MAT.shirt);
    attachPart(spnB, chest, { pos:new THREE.Vector3(0,0.05,0) });

    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.22, 0.06), MAT.denim);
    attachPart(spn2B || spnB, bib, { pos:new THREE.Vector3(0,0.02,0.03) });

    // Straps
    const strapL = new THREE.Mesh(new THREE.CylinderGeometry(0.01,0.01,0.28, 8), MAT.strap);
    strapL.rotation.z = deg(12);
    attachPart(spnB, strapL, { pos:new THREE.Vector3(-0.08, 0.15, 0.04) });
    const strapR = strapL.clone();
    strapR.rotation.z = deg(-12);
    attachPart(spnB, strapR, { pos:new THREE.Vector3(0.08, 0.15, 0.04) });
  }

  // ---- Hips / belt area (denim)
  if (hipsB){
    const belt = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.08, 6, 12), MAT.denim);
    attachPart(hipsB, belt, { pos:new THREE.Vector3(0,-0.02,0) });
  }

  // ---- Arms
  const mkLimb = (bone, radius, len, mat, offset=new THREE.Vector3(), tilt=0)=>{
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 12), mat);
    limb.rotation.z = tilt;
    attachPart(bone, limb, { pos: offset });
  };
  if (lArm) mkLimb(lArm, 0.035, 0.12, MAT.shirt, new THREE.Vector3(0,-0.05,0), deg(10));
  if (rArm) mkLimb(rArm, 0.035, 0.12, MAT.shirt, new THREE.Vector3(0,-0.05,0), deg(-10));
  if (lFore) mkLimb(lFore, 0.03,  0.13, MAT.bone,  new THREE.Vector3(0,-0.06,0));
  if (rFore) mkLimb(rFore, 0.03,  0.13, MAT.bone,  new THREE.Vector3(0,-0.06,0));
  if (lHand){
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.03,0.09), MAT.bone);
    attachPart(lHand, palm, { pos:new THREE.Vector3(0,-0.02,0.015) });
  }
  if (rHand){
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.03,0.09), MAT.bone);
    attachPart(rHand, palm, { pos:new THREE.Vector3(0,-0.02,0.015) });
  }

  // ---- Legs (denim)
  if (lUpLeg) mkLimb(lUpLeg, 0.055, 0.18, MAT.denim, new THREE.Vector3(0,-0.1,0));
  if (rUpLeg) mkLimb(rUpLeg, 0.055, 0.18, MAT.denim, new THREE.Vector3(0,-0.1,0));
  if (lLeg)   mkLimb(lLeg,   0.05,  0.18, MAT.denim, new THREE.Vector3(0,-0.09,0));
  if (rLeg)   mkLimb(rLeg,   0.05,  0.18, MAT.denim, new THREE.Vector3(0,-0.09,0));

  // ---- Boots
  const mkBoot = (bone)=>{
    const shaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.05, 8, 16), MAT.boot);
    attachPart(bone, shaft, { pos:new THREE.Vector3(0,0.03,0) });
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 18), MAT.boot);
    attachPart(bone, toe, { pos:new THREE.Vector3(0, -0.015, 0.1) });
    const heel = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.03,0.05), MAT.boot);
    attachPart(bone, heel, { pos:new THREE.Vector3(0,-0.02,-0.04) });
  };
  if (lFoot) mkBoot(lFoot);
  if (rFoot) mkBoot(rFoot);
}

// ---------- LOAD RIG & BUILD ----------
async function loadRigAndBuild(){
  const loader=new FBXLoader();
  const rig = await loader.loadAsync(FBX_BASE + BASE_RIG);

  // Scale Mixamo rig down to Three units
  rig.scale.setScalar(0.01);
  rig.traverse(o=>{
    // Hide any imported meshes to avoid "camo" artifacts
    if (o.isMesh || o.isSkinnedMesh) o.visible = false;
  });

  scene.add(rig);
  rigRoot = rig;

  // Build the procedural cowboy on top of bones
  buildProceduralCowboy(rigRoot);

  // Animation mixer
  mixer = new THREE.AnimationMixer(rigRoot);

  // Auto-frame the camera to the rig
  const box=new THREE.Box3().setFromObject(rigRoot);
  const size=box.getSize(new THREE.Vector3()).length();
  const center=box.getCenter(new THREE.Vector3());
  camera.position.copy(center.clone().add(new THREE.Vector3(size/1.5,size/2.2,size/1.5)));
  camera.lookAt(center);
}

// ---------- ANIMS ----------
async function loadClip(name){
  if(cache[name]) return cache[name];
  const loader=new FBXLoader();
  const fbx=await loader.loadAsync(FBX_BASE + name + ".fbx");
  const clip=fbx.animations?.[0];
  cache[name]=clip;
  return clip;
}

async function play(name){
  if(!mixer) return;
  const clip = await loadClip(name);
  if(!clip) return;
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);
  if (currentAction) currentAction.crossFadeTo(action, 0.4, false);
  action.play();
  currentAction = action;
}

// ---------- LOOP ----------
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

// ---------- BOOT ----------
async function boot(){
  setStatus("Initializing Bob (procedural)...");
  initThree();

  try{
    await loadRigAndBuild();
    await play(START_ANIM); // e.g., "Neutral Idle"
  } catch (err){
    console.error(err);
    setStatus("⚠️ Failed to load rig or animation.");
    return;
  }

  setStatus("👂 Listening...");
  animate();
}

boot().catch(e=>{ console.error(e); setStatus("❌ Load error."); });
