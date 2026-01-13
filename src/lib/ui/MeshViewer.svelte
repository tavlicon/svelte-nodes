<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
  
  // Props
  let {
    meshUrl = '',
    width = 200,
    height = 200,
    autoRotate = true,
    backgroundColor = 0xeeeeee,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
    showLoading = true, // Whether to show loading overlay
    paused = false, // Whether to pause auto-rotation
    visible = true, // Whether the viewer is currently visible (controls animation)
  }: {
    meshUrl?: string;
    width?: number;
    height?: number;
    autoRotate?: boolean;
    backgroundColor?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    showLoading?: boolean;
    paused?: boolean;
    visible?: boolean;
  } = $props();
  
  // Container ref
  let container: HTMLDivElement;
  
  // Three.js objects
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let renderer: THREE.WebGLRenderer;
  let controls: OrbitControls;
  let mesh: THREE.Object3D | null = null;
  let animationId: number;
  let isInitialized = false;
  
  // Loading state
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let loadedMeshUrl = ''; // Track which URL is currently loaded to prevent reloading
  let frameCount = 0; // Count frames after mesh load for seamless thumbnail transition
  const FRAMES_BEFORE_AUTOROTATE = 3; // Wait a few frames before starting auto-rotate
  
  function init() {
    if (!container || isInitialized) return;
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    
    // Camera
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(2, 1.5, 2);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    container.appendChild(renderer.domElement);
    
    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 2;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 10;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);
    
    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-5, 3, -5);
    scene.add(backLight);
    
    // Add a subtle grid for reference (lighter colors for light background)
    const gridHelper = new THREE.GridHelper(2, 10, 0xcccccc, 0xdddddd);
    gridHelper.position.y = -0.5;
    scene.add(gridHelper);
    
    isInitialized = true;
    
    // Start animation loop
    animate();
  }
  
  function animate() {
    animationId = requestAnimationFrame(animate);
    
    // Only update and render when visible
    if (!visible) return;
    
    if (controls) {
      // Disable auto-rotate until a few frames after becoming visible (for seamless thumbnail transition)
      // Also pause when paused prop is true
      const canAutoRotate = frameCount >= FRAMES_BEFORE_AUTOROTATE;
      controls.autoRotate = autoRotate && !paused && canAutoRotate;
      controls.update();
    }
    
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
      // Count frames after becoming visible
      if (mesh && frameCount < FRAMES_BEFORE_AUTOROTATE) {
        frameCount++;
      }
    }
  }
  
  async function loadMesh(url: string, force = false) {
    if (!url || !isInitialized) return;
    
    // Skip if already loaded (prevents reload on resize/drag)
    if (url === loadedMeshUrl && !force) return;
    
    isLoading = true;
    error = null;
    frameCount = 0; // Reset for seamless transition
    
    // Remove existing mesh
    if (mesh) {
      scene.remove(mesh);
      mesh = null;
    }
    
    try {
      const loader = new GLTFLoader();
      
      // Handle relative URLs
      let loadUrl = url;
      if (url.startsWith('/')) {
        loadUrl = url; // Use as-is for relative paths
      }
      
      const gltf = await loader.loadAsync(loadUrl);
      mesh = gltf.scene;
      
      // Center and scale the mesh (must match glb-thumbnail.ts exactly!)
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Center the mesh
      mesh.position.sub(center);
      
      // Scale to fit in view
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.5 / maxDim;
      mesh.scale.setScalar(scale);
      
      // Apply user-specified rotation (in degrees, convert to radians)
      mesh.rotation.x = THREE.MathUtils.degToRad(rotationX);
      mesh.rotation.y = THREE.MathUtils.degToRad(rotationY);
      mesh.rotation.z = THREE.MathUtils.degToRad(rotationZ);
      
      // Add to scene
      scene.add(mesh);
      
      // Reset camera position (must match glb-thumbnail.ts exactly!)
      camera.position.set(2, 1.5, 2);
      controls.target.set(0, 0, 0);
      controls.update();
      
      // Track loaded URL
      loadedMeshUrl = url;
      
    } catch (e) {
      console.error('Failed to load mesh:', e);
      error = e instanceof Error ? e.message : 'Failed to load 3D model';
    } finally {
      isLoading = false;
    }
  }
  
  function resize(newWidth: number, newHeight: number) {
    if (!isInitialized) return;
    
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  }
  
  // Reset camera to starting position (matches thumbnail exactly)
  function resetCamera() {
    if (!isInitialized || !controls) return;
    
    camera.position.set(2, 1.5, 2);
    controls.target.set(0, 0, 0);
    controls.update();
    frameCount = 0; // Reset frame count so auto-rotate waits
  }
  
  function cleanup() {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    
    if (controls) {
      controls.dispose();
    }
    
    if (renderer) {
      renderer.dispose();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    }
    
    if (mesh) {
      scene.remove(mesh);
    }
    
    isInitialized = false;
  }
  
  // Initialize on mount
  onMount(() => {
    init();
    if (meshUrl) {
      loadMesh(meshUrl);
    }
  });
  
  // Watch for meshUrl changes
  $effect(() => {
    if (meshUrl && isInitialized) {
      loadMesh(meshUrl);
    }
  });
  
  // Watch for size changes
  $effect(() => {
    if (isInitialized) {
      resize(width, height);
    }
  });
  
  // Watch for rotation changes
  $effect(() => {
    if (mesh && isInitialized) {
      mesh.rotation.x = THREE.MathUtils.degToRad(rotationX);
      mesh.rotation.y = THREE.MathUtils.degToRad(rotationY);
      mesh.rotation.z = THREE.MathUtils.degToRad(rotationZ);
    }
  });
  
  // Reset camera when becoming visible (for seamless thumbnail-to-animation transition)
  let prevVisible = visible;
  $effect(() => {
    if (visible && !prevVisible && isInitialized) {
      // Just became visible - reset to starting position
      resetCamera();
    }
    prevVisible = visible;
  });
  
  // Cleanup on destroy
  onDestroy(() => {
    cleanup();
  });
</script>

<div 
  class="mesh-viewer" 
  bind:this={container}
  style:width="{width}px"
  style:height="{height}px"
>
  {#if isLoading && showLoading}
    <div class="loading-overlay">
      <div class="spinner"></div>
      <span>Loading 3D model...</span>
    </div>
  {/if}
  
  {#if error && showLoading}
    <div class="error-overlay">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{error}</span>
    </div>
  {/if}
  
  {#if !meshUrl && showLoading}
    <div class="placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      <span>No mesh loaded</span>
    </div>
  {/if}
</div>

<style>
  .mesh-viewer {
    position: relative;
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    background: #eeeeee;
  }
  
  .mesh-viewer :global(canvas) {
    display: block;
    border-radius: inherit;
  }
  
  .loading-overlay,
  .error-overlay,
  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(238, 238, 238, 0.9);
    color: rgba(0, 0, 0, 0.5);
    font-size: 12px;
  }
  
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(0, 0, 0, 0.1);
    border-top-color: var(--accent-primary, #6366f1);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  
  .error-overlay {
    color: var(--error, #ef4444);
  }
  
  .placeholder svg {
    opacity: 0.4;
  }
</style>
