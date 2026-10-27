import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls, model, hullMat, deckMat, railMat;
export let initialized = false;

function is1950() {
  try {
    const draft = JSON.parse(localStorage.getItem('customBuildDraft'));
    const name = draft?.boatData?.name || '';
    if (/1950/i.test(name)) return true;
    // Also check if we're in boat cust for 1950
    const boatNameEl = document.getElementById('boatModelName');
    if (boatNameEl && /1950/i.test(boatNameEl.textContent)) return true;
  } catch (e) { }
  return false;
}

function recolorMaterialByName(modelObj, keyword, hex) {
  if (!modelObj) return;
  const kw = keyword.toLowerCase();
  modelObj.traverse((child) => {
    if (child.isMesh) {
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => {
          if (!mat) return;
          const mname = (mat.name || '').toLowerCase();
          let shouldApply = mname.includes(kw);
          if (!shouldApply && kw === 'body') {
            if (mname.includes('tripo_material') && mat.map) {
              shouldApply = true;
            }
          }
          if (shouldApply) {
            if (!mat.color) mat.color = new THREE.Color(hex);
            else mat.color.set(hex);
            mat.needsUpdate = true;
          }
        });
      } else if (child.material) {
        const mat = child.material;
        const mname = (mat.name || '').toLowerCase();
        let shouldApply = mname.includes(kw);
        if (!shouldApply && kw === 'body') {
          if (mname.includes('tripo_material') && mat.map) {
            shouldApply = true;
          }
        }
        if (shouldApply) {
          if (!mat.color) mat.color = new THREE.Color(hex);
          else mat.color.set(hex);
          mat.needsUpdate = true;
        }
      }
    }
  });
}

export function setBodyColor(hex) { 
  recolorMaterialByName(model, 'body', hex);
  // Also try to recolor the main textured material if body named differently
  if (model) {
    model.traverse((child) => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => {
            if (!mat) return;
            const mname = (mat.name || '').toLowerCase();
            if (mname.includes('tripo_material') && mat.map) {
              if (!mat.color) mat.color = new THREE.Color(hex);
              else mat.color.set(hex);
              mat.needsUpdate = true;
            }
          });
        } else if (child.material) {
          const mat = child.material;
          const mname = (mat.name || '').toLowerCase();
          if (mname.includes('tripo_material') && mat.map) {
            if (!mat.color) mat.color = new THREE.Color(hex);
            else mat.color.set(hex);
            mat.needsUpdate = true;
          }
        }
      }
    });
  }
}
export function setRoofColor(hex) { 
  if (model) {
    model.traverse((child) => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => {
            if (!mat) return;
            const name = (mat.name || '').toLowerCase();
            if (name.includes('roof')) {
              if (!mat.color) mat.color = new THREE.Color(hex);
              else mat.color.set(hex);
              mat.needsUpdate = true;
            }
          });
        } else if (child.material) {
          const name = (child.material.name || '').toLowerCase();
          if (name.includes('roof')) {
            if (!child.material.color) child.material.color = new THREE.Color(hex);
            else child.material.color.set(hex);
            child.material.needsUpdate = true;
          }
        }
      }
    });
  }
  if (deckMat && /roof/i.test(deckMat.name || '')) {
    if (!deckMat.color) deckMat.color = new THREE.Color(hex);
    else deckMat.color.set(hex);
    deckMat.needsUpdate = true;
  }
}
export function setDoorColor(hex) { recolorMaterialByName(model, 'door', hex); }

export function initThreeViewer() {
  const container = document.getElementById('threeViewer');
  if (!container) return;
  if (initialized && renderer && renderer.domElement && container.contains(renderer.domElement)) {
    try {
      renderer.setSize(container.clientWidth || container.offsetWidth, container.clientHeight || container.offsetHeight);
      if (camera) {
        camera.aspect = (container.clientWidth || container.offsetWidth) / (container.clientHeight || container.offsetHeight);
        camera.updateProjectionMatrix();
      }
    } catch(e){}
    return;
  }
  if (renderer && renderer.domElement && container.contains(renderer.domElement)) {
    container.removeChild(renderer.domElement);
  }
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  
  camera = new THREE.PerspectiveCamera(50, (container.clientWidth || container.offsetWidth || 400) / (container.clientHeight || container.offsetHeight || 400), 0.1, 10000);
  camera.position.set(15, 10, 20);
  
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth || container.offsetWidth || 400, container.clientHeight || container.offsetHeight || 400);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);
  initialized = true;
  
  if (controls) controls.dispose?.();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = true;
  controls.zoomSpeed = 0.4;
  controls.enablePan = false;
  controls.rotateSpeed = 0.4;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 1.0;
  controls.minPolarAngle = Math.PI / 4;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(10, 20, 10);
  scene.add(directionalLight);
  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight2.position.set(-10, 15, -10);
  scene.add(directionalLight2);
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);
  
  const loader = new GLTFLoader();
  const modelUrl = new URL('models/1950-passenger.glb', import.meta.url).href + '?v=' + Date.now() + Math.random();
  loader.load(modelUrl, (gltf) => {
    model = gltf.scene;
    // Center and scale the model
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.needsUpdate = true;
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 12 / maxDim;
    model.scale.set(scale, scale, scale);
    scene.add(model);
    
    // Recompute after scaling
    const box2 = new THREE.Box3().setFromObject(model);
    const size2 = box2.getSize(new THREE.Vector3());
    const center2 = box2.getCenter(new THREE.Vector3());
    const modelSize = Math.max(size2.x, size2.y, size2.z);
    
    camera.position.set(modelSize * 1.4, modelSize * 0.6, modelSize * 1.4);
    camera.near = modelSize * 0.01;
    camera.far = modelSize * 100;
    camera.updateProjectionMatrix();
    
    if (controls) {
      controls.target.copy(center2);
      controls.minDistance = modelSize * 1.1;
      controls.maxDistance = modelSize * 1.8;
      controls.autoRotate = false;
      controls.update();
    }
    
    model.traverse((child) => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => {
            if (!mat) return;
            const matName = (mat.name || '').toLowerCase();
            if (matName.includes('hull') || matName.includes('lower') || matName.includes('stripe')) hullMat = mat;
            if (matName.includes('deck') || matName.includes('floor')) deckMat = mat;
            if (matName.includes('roof')) deckMat = mat;
            if (matName.includes('rail')) railMat = mat;
            if (matName.includes('body')) hullMat = mat;
          });
        } else if (child.material) {
          const matName = (child.material.name || '').toLowerCase();
          if (matName.includes('hull') || matName.includes('lower') || matName.includes('stripe')) hullMat = child.material;
          if (matName.includes('deck') || matName.includes('floor')) deckMat = child.material;
          if (matName.includes('roof')) deckMat = child.material;
          if (matName.includes('rail')) railMat = child.material;
          if (matName.includes('body')) hullMat = child.material;
        }
      }
    });
    
    animate();
  }, undefined, (error) => {
    console.error('Error loading model:', error);
  });
  
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

export function showThreeView(show) {
  const threeDiv = document.getElementById('threeViewer');
  const canvas = document.getElementById('boatCanvas');
  if (!is1950()) {
    if (threeDiv) { threeDiv.style.display = 'none'; }
    if (canvas) canvas.style.display = 'block';
    return;
  }
  if (show) {
    initThreeViewer();
    if (threeDiv) {
      threeDiv.style.display = 'block';
      threeDiv.style.position = 'absolute';
      threeDiv.style.top = '0';
      threeDiv.style.left = '0';
      threeDiv.style.width = '100%';
      threeDiv.style.height = '100%';
    }
    if (canvas) canvas.style.display = 'none';
    if (renderer && threeDiv) {
      renderer.setSize(threeDiv.clientWidth || threeDiv.offsetWidth, threeDiv.clientHeight || threeDiv.offsetHeight);
      camera.aspect = (threeDiv.clientWidth || threeDiv.offsetWidth) / (threeDiv.clientHeight || threeDiv.offsetHeight);
      camera.updateProjectionMatrix();
    }
  } else {
    if (threeDiv) threeDiv.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
  }
}

export function setHullColor(hex) {
  if (hullMat) {
    if (!hullMat.color) hullMat.color = new THREE.Color(hex);
    else hullMat.color.set(hex);
    hullMat.needsUpdate = true;
    return;
  }
  if (model) {
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const name = (child.material.name || '').toLowerCase();
        if (/hull/i.test(name) || /lower/i.test(name) || /stripe/i.test(name)) {
          if (!child.material.color) child.material.color = new THREE.Color(hex);
          else child.material.color.set(hex);
          child.material.needsUpdate = true;
        }
      }
    });
  }
}

export function setDeckColor(hex) {
  if (model) {
    model.traverse((child) => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => {
            if (!mat) return;
            const name = (mat.name || '').toLowerCase();
            if (name.includes('deck') || name.includes('floor')) {
              if (!mat.color) mat.color = new THREE.Color(hex);
              else mat.color.set(hex);
              mat.needsUpdate = true;
            }
          });
        } else if (child.material) {
          const name = (child.material.name || '').toLowerCase();
          if (name.includes('deck') || name.includes('floor')) {
            if (!child.material.color) child.material.color = new THREE.Color(hex);
            else child.material.color.set(hex);
            child.material.needsUpdate = true;
          }
        }
      }
    });
  }
  if (deckMat) {
    if (!deckMat.color) deckMat.color = new THREE.Color(hex);
    else deckMat.color.set(hex);
    deckMat.needsUpdate = true;
  }
}

export function setRailColor(hex) {
  if (railMat) {
    if (!railMat.color) railMat.color = new THREE.Color(hex);
    else railMat.color.set(hex);
    railMat.needsUpdate = true;
    return;
  }
  if (model) {
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const name = (child.material.name || '').toLowerCase();
        if (/rail/i.test(name)) {
          if (!child.material.color) child.material.color = new THREE.Color(hex);
          else child.material.color.set(hex);
          child.material.needsUpdate = true;
        }
      }
    });
  }
}

export function rotateThree() {
  if (controls) {
    controls.autoRotate = !controls.autoRotate;
  }
}

export function zoomThree(dir) {
  if (controls && camera) {
    const scale = dir > 0 ? 0.96 : 1.04;
    camera.position.sub(controls.target);
    camera.position.multiplyScalar(scale);
    camera.position.add(controls.target);
    controls.update();
  }
}

export function resetThree() {
  if (model && controls && camera) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const modelSize = Math.max(size.x, size.y, size.z);
    camera.position.set(modelSize * 1.4, modelSize * 0.5, modelSize * 1.4);
    controls.target.copy(center);
    controls.minDistance = modelSize * 1.1;
    controls.maxDistance = modelSize * 1.8;
    controls.autoRotate = false;
    controls.update();
    camera.updateProjectionMatrix();
    model.rotation.set(0, 0, 0);
  }
}
