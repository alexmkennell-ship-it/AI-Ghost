import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./bob.js";

// expose globals for bob.js to use
window.THREE = THREE;
window.FBXLoader = FBXLoader;
window.OrbitControls = OrbitControls;
