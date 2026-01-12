<script lang="ts">
  /**
   * GLBHoverViewer - Animated 3D preview on hover
   * 
   * Renders a GLB model with smooth rotation animation.
   * Uses the same scene setup as glb-thumbnail.ts for seamless transition.
   * 
   * PERFORMANCE OPTIMIZATIONS:
   * - Render resolution capped at 512x512, CSS scales to fill container
   * - Single GLTFLoader instance for caching
   * - Proper cleanup on unmount (disposes geometry, materials, context)
   */
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

  interface Props {
    glbUrl: string;
    width: number;
    height: number;
    isActive?: boolean;
  }

  let { glbUrl, width, height, isActive = true }: Props = $props();

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let meshObject: THREE.Object3D | null = null;
  let animationId: number | null = null;
  let isLoaded = $state(false);
  let loadError = $state(false);
  let showViewer = $state(false);

  // Maximum render size for performance (actual size is capped)
  const MAX_RENDER_SIZE = 512;
  
  // Compute actual render dimensions (capped for performance)
  let renderWidth = $derived(Math.min(width, MAX_RENDER_SIZE));
  let renderHeight = $derived(Math.min(height, MAX_RENDER_SIZE));
  
  // Camera position matching glb-thumbnail.ts exactly
  const CAMERA_POSITION = { x: 2, y: 1.5, z: 2 };
  const BACKGROUND_COLOR = 0x1a1a1f;
  const ROTATION_SPEED = 0.008;

  // Shared loader instance for caching
  const loader = new GLTFLoader();

  function setupScene() {
    if (!container || renderer) return;

    // Create renderer at actual dimensions (capped for performance)
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    renderer.setSize(renderWidth, renderHeight);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    
    // Set clear color immediately to prevent white flash
    renderer.setClearColor(BACKGROUND_COLOR);
    
    // Apply CSS to fill container regardless of render size
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.background = '#1a1a1f'; // CSS fallback

    // Create scene BEFORE appending to DOM
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);

    // Create camera with correct aspect ratio
    camera = new THREE.PerspectiveCamera(50, renderWidth / renderHeight, 0.1, 1000);
    camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
    camera.lookAt(0, 0, 0);

    // Add lighting (matching glb-thumbnail.ts exactly)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-5, 3, -5);
    scene.add(backLight);

    // Add grid (matching glb-thumbnail.ts exactly)
    const gridHelper = new THREE.GridHelper(2, 10, 0x444444, 0x333333);
    gridHelper.position.y = -0.5;
    scene.add(gridHelper);

    // Render initial frame BEFORE appending to DOM (prevents white flash)
    renderer.render(scene, camera);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GLBHoverViewer.svelte:setupScene',message:'appending canvas to DOM',data:{showViewer,containerOpacity:container?.style.opacity,isActive},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
    // NOW append to DOM with content already rendered
    container.appendChild(renderer.domElement);

    loadModel();
  }

  async function loadModel() {
    if (!scene) return;

    try {
      const gltf = await loader.loadAsync(glbUrl);
      meshObject = gltf.scene;

      // Center and scale the mesh (matching glb-thumbnail.ts exactly)
      const box = new THREE.Box3().setFromObject(meshObject);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      meshObject.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.5 / maxDim;
      meshObject.scale.setScalar(scale);

      scene.add(meshObject);
      isLoaded = true;

      // Render first frame (matches thumbnail exactly)
      if (renderer && camera) {
        renderer.render(scene, camera);
      }

      // Fade in and start animation
      requestAnimationFrame(() => {
        showViewer = true;
        startAnimation();
      });
    } catch (error) {
      console.error('GLBHoverViewer: Failed to load', glbUrl, error);
      loadError = true;
    }
  }

  function startAnimation() {
    if (!renderer || !scene || !camera || animationId !== null) return;

    function animate() {
      if (!renderer || !scene || !camera || !isActive) {
        animationId = null;
        return;
      }

      if (meshObject) {
        meshObject.rotation.y += ROTATION_SPEED;
      }

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    }

    animate();
  }

  function stopAnimation() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function cleanup() {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GLBHoverViewer.svelte:cleanup',message:'cleanup called',data:{showViewer,hasContainer:!!container,hasRenderer:!!renderer},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,D'})}).catch(()=>{});
    // #endregion
    stopAnimation();

    // Hide immediately to prevent white flash on unmount
    showViewer = false;
    if (container) {
      container.style.opacity = '0';
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GLBHoverViewer.svelte:cleanup',message:'container opacity set to 0',data:{containerExists:true},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    }

    // Remove canvas from DOM BEFORE disposing to prevent flash
    if (renderer && container && renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GLBHoverViewer.svelte:cleanup',message:'canvas removed from DOM',timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    }

    if (meshObject) {
      meshObject.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
      meshObject = null;
    }

    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null;
    }

    if (scene) {
      scene.clear();
      scene = null;
    }

    camera = null;
    isLoaded = false;
  }

  // Handle activation state
  $effect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GLBHoverViewer.svelte:$effect',message:'isActive changed',data:{isActive,hasRenderer:!!renderer,hasContainer:!!container,isLoaded},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B,C'})}).catch(()=>{});
    // #endregion
    if (isActive && !renderer && container) {
      setupScene();
    } else if (!isActive) {
      stopAnimation();
      showViewer = false; // Hide when not active (smooth CSS transition)
    } else if (isActive && renderer && animationId === null && isLoaded) {
      startAnimation();
      showViewer = true; // Show when active and loaded
    }
  });

  onMount(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GLBHoverViewer.svelte:onMount',message:'component mounted',data:{isActive,glbUrl},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (isActive) {
      setupScene();
    }
  });

  onDestroy(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GLBHoverViewer.svelte:onDestroy',message:'onDestroy called - component unmounting',timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    cleanup();
  });
</script>

<div 
  class="glb-hover-viewer" 
  class:visible={showViewer}
  bind:this={container}
>
</div>

<style>
  .glb-hover-viewer {
    position: absolute;
    inset: 0; /* Fill parent without covering border */
    border-radius: inherit;
    overflow: hidden;
    z-index: 2;
    opacity: 0;
    transition: opacity 120ms ease-out;
    pointer-events: none;
    background: #1a1a1f; /* Match scene background to prevent flash */
  }

  .glb-hover-viewer.visible {
    opacity: 1;
  }

  /* Scale canvas to fill container via CSS */
  .glb-hover-viewer :global(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
    border-radius: inherit;
    background: #1a1a1f; /* Fallback background */
  }
</style>
