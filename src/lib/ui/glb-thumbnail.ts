/**
 * GLB Thumbnail Generator
 * 
 * Generates static thumbnail images from GLB files using Three.js.
 * Uses the same rendering setup as MeshViewer for visual consistency.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Cache for generated thumbnails
const thumbnailCache = new Map<string, string>();

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  backgroundColor?: number;
  cameraPosition?: { x: number; y: number; z: number };
  rotationX?: number; // Rotation in degrees
  rotationY?: number;
  rotationZ?: number;
}

const defaultOptions: Required<ThumbnailOptions> = {
  width: 256,
  height: 256,
  backgroundColor: 0xeeeeee, // Light gray background matching MeshViewer
  cameraPosition: { x: 2, y: 1.5, z: 2 },
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
};

/**
 * Generate a thumbnail data URL from a GLB file
 * @param glbUrl - URL to the GLB file
 * @param options - Thumbnail generation options
 * @returns Promise<string> - Data URL of the thumbnail image
 */
export async function generateGLBThumbnail(
  glbUrl: string,
  options: ThumbnailOptions = {}
): Promise<string> {
  // Check cache first
  const cacheKey = `${glbUrl}-${JSON.stringify(options)}`;
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey)!;
  }

  const opts = { ...defaultOptions, ...options };

  // Create offscreen renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: false,
  });
  renderer.setSize(opts.width, opts.height);
  renderer.setPixelRatio(1); // Use 1 for consistent output size
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  // Create scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.backgroundColor);

  // Create camera
  const camera = new THREE.PerspectiveCamera(50, opts.width / opts.height, 0.1, 1000);
  camera.position.set(opts.cameraPosition.x, opts.cameraPosition.y, opts.cameraPosition.z);
  camera.lookAt(0, 0, 0);

  // Add lighting (matching MeshViewer)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);

  const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
  backLight.position.set(-5, 3, -5);
  scene.add(backLight);

  // Add grid (matching MeshViewer - lighter colors for light background)
  const gridHelper = new THREE.GridHelper(2, 10, 0xcccccc, 0xdddddd);
  gridHelper.position.y = -0.5;
  scene.add(gridHelper);

  try {
    // Load the GLB
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(glbUrl);
    const mesh = gltf.scene;

    // Center and scale the mesh (matching MeshViewer)
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    mesh.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 1.5 / maxDim;
    mesh.scale.setScalar(scale);

    // Apply rotation (in degrees, convert to radians)
    mesh.rotation.x = THREE.MathUtils.degToRad(opts.rotationX);
    mesh.rotation.y = THREE.MathUtils.degToRad(opts.rotationY);
    mesh.rotation.z = THREE.MathUtils.degToRad(opts.rotationZ);

    scene.add(mesh);

    // Render the scene
    renderer.render(scene, camera);

    // Get the image as data URL
    const dataUrl = renderer.domElement.toDataURL('image/png');

    // Cache the result
    thumbnailCache.set(cacheKey, dataUrl);

    // Cleanup
    renderer.dispose();
    scene.clear();

    return dataUrl;
  } catch (error) {
    // Cleanup on error
    renderer.dispose();
    scene.clear();
    throw error;
  }
}

/**
 * Clear the thumbnail cache
 */
export function clearThumbnailCache(): void {
  thumbnailCache.clear();
}

/**
 * Remove a specific thumbnail from cache
 */
export function invalidateThumbnail(glbUrl: string): void {
  // Remove all cached versions of this URL
  for (const key of thumbnailCache.keys()) {
    if (key.startsWith(glbUrl)) {
      thumbnailCache.delete(key);
    }
  }
}
