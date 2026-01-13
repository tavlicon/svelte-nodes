<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { theme } from './theme.svelte';
  import { sidebarState } from './sidebarState.svelte';
  import { listFiles, formatFileSize, type FileInfo } from '../services/file-service';
  import { router, type Page } from '../router.svelte';
  import Panel from './Panel.svelte';
  import MeshViewer from './MeshViewer.svelte';
  import { generateGLBThumbnail } from './glb-thumbnail';
  
  // State for 3D mesh preview modal
  let previewMeshUrl = $state<string | null>(null);
  let previewMeshName = $state<string>('');
  
  // State for video preview modal
  let previewVideoUrl = $state<string | null>(null);
  let previewVideoName = $state<string>('');
  
  function navigateTo(page: Page) {
    router.navigate(page);
  }

  // Panel state
  let activePanel = $state<'assets' | 'models' | 'canvases' | null>(null);
  
  // Sync sidebar state with shared store (two-way)
  $effect(() => {
    sidebarState.isOpen = activePanel !== null;
  });
  
  // Listen for external open/close requests (e.g., Cmd+K or clicking on canvas)
  $effect(() => {
    if (sidebarState.isOpen && activePanel === null) {
      // External request to open - default to 'assets' panel
      activePanel = 'assets';
      refreshAssets();
    } else if (!sidebarState.isOpen && activePanel !== null) {
      // External request to close
      activePanel = null;
    }
  });

  function togglePanel(panel: 'assets' | 'models' | 'canvases') {
    if (activePanel === panel) {
      activePanel = null;
    } else {
      activePanel = panel;
      // Refresh files when opening a panel
      if (panel === 'assets') {
        refreshAssets();
      } else if (panel === 'models') {
        refreshModels();
      } else if (panel === 'canvases') {
        refreshCanvases();
      }
    }
  }

  function closePanel() {
    activePanel = null;
  }

  // Assets panel state - default to imported
  let assetsTab = $state<'generated' | 'imported'>('imported');
  
  // Tab switch handler
  function switchAssetsTab(tab: 'generated' | 'imported') {
    assetsTab = tab;
  }

  // File lists
  let generatedFiles = $state<FileInfo[]>([]);
  let importedFiles = $state<FileInfo[]>([]);
  let modelFiles = $state<FileInfo[]>([]);
  let canvasFiles = $state<FileInfo[]>([]);
  let isLoading = $state(false);
  
  // Cache for generated GLB thumbnails in sidebar
  let sidebarThumbnailCache = $state<Map<string, string>>(new Map());
  
  // Generate thumbnails for GLB files without video previews
  function generateSidebarThumbnail(glbPath: string) {
    if (sidebarThumbnailCache.has(glbPath)) return;
    
    // Mark as loading
    sidebarThumbnailCache = new Map(sidebarThumbnailCache).set(glbPath, 'loading');
    
    generateGLBThumbnail(glbPath, { width: 200, height: 200 })
      .then(dataUrl => {
        sidebarThumbnailCache = new Map(sidebarThumbnailCache).set(glbPath, dataUrl);
      })
      .catch(err => {
        console.error('Failed to generate sidebar thumbnail:', err);
        const newCache = new Map(sidebarThumbnailCache);
        newCache.delete(glbPath);
        sidebarThumbnailCache = newCache;
      });
  }
  
  // Trigger thumbnail generation reactively when Generated tab is shown
  $effect(() => {
    if (activePanel === 'assets' && assetsTab === 'generated') {
      // Generate thumbnails for GLB files that don't have video previews
      for (const file of displayedGeneratedFiles) {
        if ((file.type === 'glb' || file.type === 'gltf') && !findMatchingVideo(file)) {
          const thumbnailUrl = sidebarThumbnailCache.get(file.path);
          if (!thumbnailUrl) {
            generateSidebarThumbnail(file.path);
          }
        }
      }
    }
  });
  
  // Helper to find matching video preview for a GLB file
  // Files share timestamp_id pattern: mesh_1234_abc.glb <-> render_1234_abc.mp4
  function findMatchingVideo(glbFile: FileInfo): FileInfo | null {
    // Extract the timestamp_id from mesh filename: mesh_1234567_abcd1234.glb -> 1234567_abcd1234
    const match = glbFile.name.match(/mesh_(\d+_[a-f0-9]+)\.glb$/i);
    if (!match) return null;
    
    const timestampId = match[1];
    const videoName = `render_${timestampId}.mp4`;
    
    return generatedFiles.find(f => f.name === videoName) || null;
  }
  
  // Filter out video files that are previews for GLBs (they'll be shown as thumbnails)
  let displayedGeneratedFiles = $derived.by(() => {
    // Get all GLB timestamp_ids
    const glbTimestampIds = new Set<string>();
    for (const file of generatedFiles) {
      const match = file.name.match(/mesh_(\d+_[a-f0-9]+)\.glb$/i);
      if (match) glbTimestampIds.add(match[1]);
    }
    
    // Filter out video files that match a GLB
    return generatedFiles.filter(file => {
      if (file.type === 'mp4' || file.type === 'webm') {
        const videoMatch = file.name.match(/render_(\d+_[a-f0-9]+)\.(mp4|webm)$/i);
        if (videoMatch && glbTimestampIds.has(videoMatch[1])) {
          return false; // Skip - this video is a preview for a GLB
        }
      }
      return true;
    });
  });

  // Known directory-based models (not discovered via file listing)
  // These models exist in subdirectories with their own structure
  const knownDirectoryModels: FileInfo[] = [
    {
      name: 'triposr-base',
      path: '/data/models/triposr-base',
      size: 0, // Directory-based model
      modified: new Date().toISOString(),
      type: 'triposr',
      metadata: {
        title: 'TripoSR',
        description: 'Single-image to 3D mesh generation',
        architecture: 'triposr',
      }
    },
    {
      name: 'sdxl-turbo',
      path: '', // Not yet available
      size: 0,
      modified: new Date().toISOString(),
      type: 'sdxl',
      metadata: {
        title: 'SDXL Turbo',
        description: 'Fast text-to-image generation (Coming Soon)',
        architecture: 'sdxl-turbo',
        inactive: true, // Placeholder - not yet implemented
      }
    }
  ];

  // Refresh functions
  async function refreshAssets() {
    isLoading = true;
    try {
      const [generated, imported] = await Promise.all([
        listFiles('output'),
        listFiles('input'),
      ]);
      generatedFiles = generated;
      importedFiles = imported;
    } catch (error) {
      console.error('Error refreshing assets:', error);
    } finally {
      isLoading = false;
    }
  }

  async function refreshModels() {
    isLoading = true;
    try {
      // Get file-based models (safetensors, etc.)
      const fileModels = await listFiles('models');
      // Combine with known directory-based models
      modelFiles = [...knownDirectoryModels, ...fileModels];
    } catch (error) {
      console.error('Error refreshing models:', error);
    } finally {
      isLoading = false;
    }
  }

  async function refreshCanvases() {
    isLoading = true;
    try {
      // For canvases, we list JSON files from the canvases directory
      const response = await fetch('/api/files?dir=canvases');
      if (response.ok) {
        canvasFiles = await response.json();
      }
    } catch (error) {
      console.error('Error refreshing canvases:', error);
    } finally {
      isLoading = false;
    }
  }

  function refreshFiles() {
    if (activePanel === 'assets') {
      refreshAssets();
    } else if (activePanel === 'models') {
      refreshModels();
    } else if (activePanel === 'canvases') {
      refreshCanvases();
    }
  }

  // Listen for file changes from other components
  function handleFilesChanged(e: CustomEvent) {
    const { directory } = e.detail;
    if (directory === 'input' || directory === 'output') {
      refreshAssets();
    } else if (directory === 'canvases') {
      refreshCanvases();
    }
  }

  // Handle dragging images from sidebar to canvas
  function handleImageDragStart(e: DragEvent, file: FileInfo) {
    if (!e.dataTransfer) return;
    
    // Set custom data type for sidebar images
    e.dataTransfer.setData('application/x-sidebar-image', JSON.stringify({
      path: file.path,
      name: file.name,
      type: file.type,
    }));
    
    e.dataTransfer.effectAllowed = 'copy';
  }
  
  // Handle dragging 3D meshes from sidebar to canvas
  function handleMeshDragStart(e: DragEvent, file: FileInfo) {
    if (!e.dataTransfer) return;
    
    // Find matching video preview for this GLB
    const matchingVideo = findMatchingVideo(file);
    
    // Set custom data type for sidebar meshes
    e.dataTransfer.setData('application/x-sidebar-mesh', JSON.stringify({
      path: file.path,
      name: file.name,
      type: file.type,
      size: file.size,
      videoUrl: matchingVideo?.path || null,
    }));
    
    e.dataTransfer.effectAllowed = 'copy';
  }
  
  // Click-to-add: dispatch event to add mesh to canvas
  function handleMeshClick(file: FileInfo) {
    // Find matching video preview for this GLB
    const matchingVideo = findMatchingVideo(file);
    
    window.dispatchEvent(new CustomEvent('sidebar-add-mesh', {
      detail: {
        path: file.path,
        name: file.name,
        type: file.type,
        videoUrl: matchingVideo?.path || null,
      }
    }));
  }

  // Handle dragging models from sidebar to canvas
  function handleModelDragStart(e: DragEvent, file: FileInfo) {
    if (!e.dataTransfer) return;
    
    // Set custom data type for sidebar models
    e.dataTransfer.setData('application/x-sidebar-model', JSON.stringify({
      path: file.path,
      name: file.name,
      type: file.type,
      size: file.size,
      metadata: file.metadata,
    }));
    
    e.dataTransfer.effectAllowed = 'copy';
  }

  // Click-to-add: dispatch event to add image to canvas
  function handleImageClick(file: FileInfo) {
    window.dispatchEvent(new CustomEvent('sidebar-add-image', {
      detail: {
        path: file.path,
        name: file.name,
        type: file.type,
      }
    }));
  }

  // Click-to-add: dispatch event to add model to canvas
  function handleModelClick(file: FileInfo) {
    // Determine which event to dispatch based on model type
    const eventName = file.type === 'triposr' ? 'sidebar-add-triposr' : 'sidebar-add-model';
    window.dispatchEvent(new CustomEvent(eventName, {
      detail: {
        path: file.path,
        name: file.name,
        type: file.type,
        size: file.size,
        metadata: file.metadata,
      }
    }));
  }

  onMount(() => {
    window.addEventListener('files-changed', handleFilesChanged as EventListener);
    // Initial load
    refreshAssets();
  });

  onDestroy(() => {
    window.removeEventListener('files-changed', handleFilesChanged as EventListener);
  });
</script>

<div class="sidebar-container">
  <!-- Icon sidebar (nav) -->
  <nav class="icon-sidebar">
    <button 
      class="sidebar-icon"
      class:active={activePanel === 'assets'}
      onclick={() => togglePanel('assets')}
      title="Assets"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
      <span class="icon-label">Assets</span>
    </button>
    
    <button 
      class="sidebar-icon"
      class:active={activePanel === 'models'}
      onclick={() => togglePanel('models')}
      title="Models"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
      <span class="icon-label">Models</span>
    </button>
    
    <button 
      class="sidebar-icon disabled"
      disabled
      title="Canvases (Coming Soon)"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="8" height="6" rx="1" />
        <rect x="13" y="3" width="8" height="6" rx="1" />
        <rect x="8" y="15" width="8" height="6" rx="1" />
        <path d="M7 9v3a3 3 0 003 3h0" stroke-linecap="round" />
        <path d="M17 9v3a3 3 0 01-3 3h0" stroke-linecap="round" />
      </svg>
      <span class="icon-label">Canvases</span>
    </button>
    
    <!-- Spacer -->
    <div class="sidebar-spacer"></div>
    
    <!-- Page navigation: Only show UI button on Canvas page -->
    <button 
      class="sidebar-icon page-nav"
      onclick={() => navigateTo('ui')}
      title="UI Library"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
      </svg>
      <span class="icon-label">UI</span>
    </button>
  </nav>
  
  <!-- Floating panel -->
  <div class="floating-panel-container">
    <Panel visible={activePanel !== null} width={429} position="left">
      {#snippet customHeader()}
      {#if activePanel === 'assets'}
        <div class="panel-header">
          <div class="panel-tabs">
            <button 
              class="panel-tab"
              class:active={assetsTab === 'imported'}
              onclick={(e) => { e.stopPropagation(); switchAssetsTab('imported'); }}
            >
              Imported
            </button>
            <button 
              class="panel-tab"
              class:active={assetsTab === 'generated'}
              onclick={(e) => { e.stopPropagation(); switchAssetsTab('generated'); }}
            >
              Generated
            </button>
          </div>
          <div class="header-actions">
            <button class="icon-btn" onclick={refreshFiles} title="Refresh">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button class="icon-btn" onclick={closePanel} title="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {:else if activePanel === 'models'}
          <div class="panel-header">
            <div class="panel-tabs">
              <button class="panel-tab active">Models</button>
            </div>
            <div class="header-actions">
              <button class="icon-btn" onclick={refreshFiles} title="Refresh">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="icon-btn" onclick={closePanel} title="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        {:else if activePanel === 'canvases'}
          <div class="panel-header">
            <div class="panel-tabs">
              <button class="panel-tab active">Canvases</button>
            </div>
            <div class="header-actions">
              <button class="icon-btn" onclick={refreshFiles} title="Refresh">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="icon-btn" onclick={closePanel} title="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        {/if}
      {/snippet}
      
      <!-- Panel Content -->
      {#if activePanel === 'assets'}
        <div class="panel-content">
          {#if isLoading}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Loading...</p>
            </div>
          {:else if assetsTab === 'generated'}
            {#if displayedGeneratedFiles.length === 0}
              <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <h3>No generated assets</h3>
                <p>Run the graph to generate images or 3D meshes</p>
              </div>
            {:else}
              <div class="file-grid">
                {#each displayedGeneratedFiles as file (file.name)}
                  {#if file.type === 'glb' || file.type === 'gltf'}
                    {@const matchingVideo = findMatchingVideo(file)}
                    {@const thumbnailUrl = sidebarThumbnailCache.get(file.path)}
                    <div class="file-card mesh-card-wrapper">
                      <button 
                        class="file-card mesh-card" 
                        title={`${file.name} (${formatFileSize(file.size)}) - Click to add to canvas, drag to position`}
                        aria-label={`Add ${file.name} to canvas`}
                        type="button"
                        draggable="true"
                        ondragstart={(e) => handleMeshDragStart(e, file)}
                        onclick={() => handleMeshClick(file)}
                      >
                        {#if matchingVideo}
                          <!-- Video turntable preview as thumbnail -->
                          <div class="file-thumbnail video-thumbnail">
                            <video 
                              src={matchingVideo.path} 
                              autoplay 
                              loop 
                              muted 
                              playsinline
                              draggable="false"
                            />
                            <span class="mesh-label">3D</span>
                          </div>
                        {:else if thumbnailUrl && thumbnailUrl !== 'loading'}
                          <!-- GLB thumbnail (generated client-side) -->
                          <div class="file-thumbnail glb-thumbnail">
                            <img src={thumbnailUrl} alt="3D mesh preview" draggable="false" />
                            <span class="mesh-label">3D</span>
                          </div>
                        {:else if thumbnailUrl === 'loading'}
                          <!-- Loading state while generating thumbnail -->
                          <div class="file-thumbnail mesh-thumbnail">
                            <div class="thumbnail-spinner"></div>
                            <span class="mesh-label">3D</span>
                          </div>
                        {:else}
                          <!-- Show placeholder while thumbnail is being generated (triggered by $effect) -->
                          <div class="file-thumbnail mesh-thumbnail">
                            <div class="thumbnail-spinner"></div>
                            <span class="mesh-label">3D</span>
                          </div>
                        {/if}
                      </button>
                      <button 
                        class="mesh-preview-btn"
                        title="Preview 3D model"
                        aria-label={`Preview ${file.name}`}
                        type="button"
                        onclick={(e) => { e.stopPropagation(); previewMeshUrl = file.path; previewMeshName = file.name; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      </button>
                    </div>
                  {:else if file.type === 'mp4' || file.type === 'webm'}
                    <!-- Standalone video (not linked to a GLB) - rare case -->
                    <button 
                      class="file-card video-card" 
                      title={`${file.name} (${formatFileSize(file.size)}) - Video preview`}
                      aria-label={`Preview ${file.name}`}
                      type="button"
                      onclick={() => { previewVideoUrl = file.path; previewVideoName = file.name; }}
                    >
                      <div class="file-thumbnail video-thumbnail">
                        <video 
                          src={file.path} 
                          autoplay 
                          loop 
                          muted 
                          playsinline
                          draggable="false"
                        />
                        <span class="video-label">3D</span>
                      </div>
                    </button>
                  {:else}
                    <button 
                      class="file-card" 
                      title={`${file.name} (${formatFileSize(file.size)})`}
                      aria-label={`Add ${file.name} to canvas`}
                      draggable="true"
                      ondragstart={(e) => handleImageDragStart(e, file)}
                      onclick={() => handleImageClick(file)}
                      type="button"
                    >
                      <div class="file-thumbnail">
                        <img src={file.path} alt={file.name} loading="lazy" draggable="false" />
                      </div>
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}
          {:else}
            {#if importedFiles.length === 0}
              <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <h3>No imported assets</h3>
                <p>Drop images onto the canvas to import</p>
              </div>
            {:else}
              <div class="file-grid">
                {#each importedFiles as file (file.name)}
                  <button 
                    class="file-card" 
                    title={`${file.name} (${formatFileSize(file.size)})`}
                    aria-label={`Add ${file.name} to canvas`}
                    draggable="true"
                    ondragstart={(e) => handleImageDragStart(e, file)}
                    onclick={() => handleImageClick(file)}
                    type="button"
                  >
                    <div class="file-thumbnail">
                      <img src={file.path} alt={file.name} loading="lazy" draggable="false" />
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {:else if activePanel === 'models'}
        <div class="panel-content">
          {#if isLoading}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Loading...</p>
            </div>
          {:else if modelFiles.length === 0}
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <h3>No models available</h3>
              <p>Add models to data/models directory</p>
            </div>
          {:else}
            <div class="file-list">
              {#each modelFiles as file (file.name)}
                <button 
                  class="file-item model-item" 
                  class:inactive={file.metadata?.inactive}
                  title={file.metadata?.inactive ? `${file.metadata?.title || file.name} (Coming Soon)` : (file.metadata?.description || file.name)}
                  aria-label={file.metadata?.inactive ? `${file.metadata?.title || file.name} - Coming Soon` : `Add ${file.metadata?.title || file.name} to canvas`}
                  draggable={!file.metadata?.inactive}
                  ondragstart={(e) => !file.metadata?.inactive && handleModelDragStart(e, file)}
                  onclick={() => !file.metadata?.inactive && handleModelClick(file)}
                  type="button"
                  disabled={file.metadata?.inactive}
                >
                  <div class="model-icon" class:triposr={file.type === 'triposr'} class:sdxl={file.type === 'sdxl'}>
                    {#if file.type === 'triposr'}
                      <!-- 3D cube icon for TripoSR -->
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                    {:else if file.type === 'sdxl'}
                      <!-- Sparkle icon for SDXL -->
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                        <circle cx="12" cy="12" r="4" />
                      </svg>
                    {:else}
                      <!-- Layer stack icon for SD/other models -->
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5" />
                        <path d="M2 12l10 5 10-5" />
                      </svg>
                    {/if}
                  </div>
                  <div class="model-info">
                    <span class="file-name">{file.metadata?.title || file.name}</span>
                    <div class="model-meta">
                      <span class="model-type">{file.type === 'triposr' ? '3D' : file.type.toUpperCase()}</span>
                      {#if file.metadata?.inactive}
                        <span class="model-badge inactive">Coming Soon</span>
                      {:else if file.size > 0}
                        <span class="file-size">{formatFileSize(file.size)}</span>
                      {/if}
                    </div>
                    {#if file.metadata?.hash || file.metadata?.date}
                      <div class="model-meta-extra">
                        {#if file.metadata?.hash}
                          <span class="model-hash" title="SHA256 hash">{file.metadata.hash}</span>
                        {/if}
                        {#if file.metadata?.date}
                          <span class="model-date">{file.metadata.date}</span>
                        {/if}
                      </div>
                    {/if}
                    {#if file.metadata?.description}
                      <div class="model-description">{file.metadata.description}</div>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else if activePanel === 'canvases'}
        <div class="panel-content">
          {#if isLoading}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Loading...</p>
            </div>
          {:else if canvasFiles.length === 0}
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <h3>No saved canvases</h3>
              <p>Canvases will appear here when saved</p>
            </div>
          {:else}
            <div class="file-list">
              {#each canvasFiles as file (file.name)}
                <div class="file-item canvas-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="8" height="6" rx="1" />
                    <rect x="13" y="3" width="8" height="6" rx="1" />
                    <rect x="8" y="15" width="8" height="6" rx="1" />
                    <path d="M7 9v3a3 3 0 003 3h0" stroke-linecap="round" />
                    <path d="M17 9v3a3 3 0 01-3 3h0" stroke-linecap="round" />
                  </svg>
                  <div class="canvas-info">
                    <span class="file-name">{file.name.replace('.json', '')}</span>
                    <span class="file-date">{new Date(file.modified).toLocaleDateString()}</span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </Panel>
    </div>
</div>

<!-- 3D Mesh Preview Modal -->
{#if previewMeshUrl}
  <div class="mesh-preview-modal" onclick={() => previewMeshUrl = null} onkeydown={(e) => e.key === 'Escape' && (previewMeshUrl = null)} role="button" tabindex="0">
    <div class="mesh-preview-content" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="3D Preview">
      <div class="mesh-preview-header">
        <h3>3D Preview</h3>
        <span class="mesh-filename">{previewMeshName}</span>
        <button class="mesh-preview-close" onclick={() => previewMeshUrl = null} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="mesh-preview-viewer">
        <MeshViewer meshUrl={previewMeshUrl} width={400} height={350} autoRotate={true} />
      </div>
      <div class="mesh-preview-actions">
        <a href={previewMeshUrl} download={previewMeshName} class="mesh-download-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download GLB
        </a>
      </div>
    </div>
  </div>
{/if}

<!-- Video Preview Modal -->
{#if previewVideoUrl}
  <div class="video-preview-modal" onclick={() => previewVideoUrl = null} onkeydown={(e) => e.key === 'Escape' && (previewVideoUrl = null)} role="button" tabindex="0">
    <div class="video-preview-content" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Video Preview">
      <div class="video-preview-header">
        <h3>Turntable Preview</h3>
        <span class="video-filename">{previewVideoName}</span>
        <button class="video-preview-close" onclick={() => previewVideoUrl = null} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="video-preview-viewer">
        <video 
          src={previewVideoUrl} 
          autoplay 
          loop 
          muted 
          playsinline
          controls
        />
      </div>
      <div class="video-preview-actions">
        <a href={previewVideoUrl} download={previewVideoName} class="video-download-btn-large">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Download MP4
        </a>
      </div>
    </div>
  </div>
{/if}

<style>
  .sidebar-container {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    display: flex;
    z-index: 50;
    pointer-events: none;
  }
  
  /* Icon sidebar (nav) */
  .icon-sidebar {
    display: flex;
    flex-direction: column;
    width: 72px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-subtle);
    padding: 12px 0;
    gap: 4px;
    pointer-events: auto;
  }
  
  .sidebar-spacer {
    flex: 1;
    min-height: 20px;
  }
  
  .sidebar-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px;
    margin: 0 8px;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
    border-radius: var(--radius-md);
  }
  
  .sidebar-icon:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
  
  .sidebar-icon.active {
    color: var(--accent-primary);
    background: var(--accent-glow);
  }
  
  .sidebar-icon.disabled,
  .sidebar-icon:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  
  .icon-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  
  /* Floating panel container */
  .floating-panel-container {
    position: absolute;
    left: calc(72px + 12px); /* nav width + gap */
    top: 12px;
    bottom: 36px;
    pointer-events: none;
  }
  
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px 16px;
    background: transparent;
    flex-shrink: 0;
  }
  
  .panel-tabs {
    display: flex;
    gap: 16px;
  }
  
  .panel-tab {
    padding: 0;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
    position: relative;
  }
  
  .panel-tab:hover {
    color: rgba(255, 255, 255, 0.6);
  }
  
  .panel-tab.active {
    color: #ffffff;
  }
  
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s ease;
  }
  
  .icon-btn:hover {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.06);
  }
  
  .icon-btn svg {
    width: 16px;
    height: 16px;
  }
  
  /* Panel content with custom scrollbar */
  .panel-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0; /* Critical: allows flex child to shrink and become the scroll container */
    padding: 0 8px 24px 8px;
    margin-right: 2px; /* Nudge scrollbar 2px left */
    
    /* Custom scrollbar */
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  
  .panel-content::-webkit-scrollbar {
    width: 6px;
  }
  
  .panel-content::-webkit-scrollbar-track {
    background: transparent;
    margin: 4px 0;
  }
  
  .panel-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }
  
  .panel-content::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  
  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 16px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .empty-state svg {
    margin-bottom: 12px;
    opacity: 0.3;
    width: 40px;
    height: 40px;
  }
  
  .empty-state h3 {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.6);
    margin: 0 0 4px 0;
  }
  
  .empty-state p {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 12px;
    margin: 0;
    opacity: 0.7;
  }
  
  /* File list */
  .file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  
  .file-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    background: #1c1c1f;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    gap: 10px;
    /* Reset button styles */
    font: inherit;
    text-align: left;
    width: 100%;
    border: none;
    color: inherit;
  }
  
  .file-item:hover {
    background: #242428;
  }
  
  .file-item svg {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .canvas-item .canvas-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  
  .canvas-item .file-date {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  /* Model items */
  .model-item {
    padding: 10px 12px;
    align-items: flex-start;
  }
  
  .model-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(99, 102, 241, 0.15);
    border-radius: 8px;
    flex-shrink: 0;
  }
  
  .model-icon svg {
    color: #6366f1;
    width: 18px;
    height: 18px;
  }
  
  .model-icon.triposr {
    background: rgba(16, 185, 129, 0.15);
  }
  
  .model-icon.triposr svg {
    color: #10b981;
  }
  
  .model-icon.sdxl {
    background: rgba(168, 85, 247, 0.15);
  }
  
  .model-icon.sdxl svg {
    color: #a855f7;
  }
  
  /* Inactive model styling */
  .model-item.inactive {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
  
  .model-item.inactive:hover {
    background: transparent;
    border-color: transparent;
  }
  
  .model-badge.inactive {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.5);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .model-description {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 2px;
    line-height: 1.3;
  }
  
  .model-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }
  
  .model-info .file-name {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    word-break: break-word;
    white-space: normal;
    color: #ffffff;
  }
  
  .model-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .model-type {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9px;
    font-weight: 600;
    color: #6366f1;
    background: rgba(99, 102, 241, 0.15);
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.02em;
  }
  
  .model-meta-extra {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  
  .model-hash {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0.7;
  }
  
  .model-date {
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0.7;
  }
  
  .model-item[draggable="true"] {
    cursor: grab;
  }
  
  .model-item[draggable="true"]:active {
    cursor: grabbing;
    opacity: 0.7;
  }
  
  .file-name {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 12px;
    color: #ffffff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* File grid for images - 3 columns, responsive to 2 */
  .file-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  
  @media (max-width: 800px) {
    .floating-panel {
      width: 360px;
    }
    
    .file-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  .file-card {
    display: flex;
    flex-direction: column;
    background: transparent;
    border-radius: 4px;
    overflow: hidden;
    /* Reset button styles */
    font: inherit;
    padding: 0;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }
  
  .file-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  
  .file-card[draggable="true"] {
    cursor: grab;
  }
  
  .file-card[draggable="true"]:active {
    cursor: grabbing;
    opacity: 0.8;
    transform: scale(0.98);
  }
  
  .file-thumbnail {
    aspect-ratio: 1;
    overflow: hidden;
    background: #1c1c1f;
    border-radius: 4px;
  }
  
  .file-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.15s ease;
  }
  
  .file-card:hover .file-thumbnail img {
    transform: scale(1.02);
  }
  
  /* 3D Mesh card styling */
  .mesh-card {
    cursor: pointer;
  }
  
  .mesh-thumbnail {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: linear-gradient(135deg, #1e3a5f 0%, #1a2a3f 100%);
    color: #4da6ff;
  }
  
  .mesh-thumbnail svg {
    opacity: 0.8;
  }
  
  /* GLB thumbnail (generated from Three.js) */
  .glb-thumbnail {
    position: relative;
    background: #1a1a1f;
  }
  
  .glb-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }
  
  .glb-thumbnail .mesh-label {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 2px 6px;
    background: rgba(77, 166, 255, 0.9);
    color: white;
    border-radius: 4px;
  }
  
  .thumbnail-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(77, 166, 255, 0.2);
    border-top-color: #4da6ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  .mesh-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.8;
  }
  
  .mesh-card-wrapper {
    position: relative;
  }
  
  .mesh-card-wrapper:hover .mesh-thumbnail {
    background: linear-gradient(135deg, #234b75 0%, #1e3a5f 100%);
  }
  
  .mesh-card-wrapper:hover .mesh-thumbnail svg {
    opacity: 1;
  }
  
  .mesh-preview-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.8);
    opacity: 0;
    transition: all 0.15s ease;
    z-index: 2;
  }
  
  .mesh-card-wrapper:hover .mesh-preview-btn {
    opacity: 1;
  }
  
  .mesh-preview-btn:hover {
    background: rgba(99, 102, 241, 0.9);
    color: white;
  }
  
  /* Hidden by default - only shown when needed */
  .file-info {
    display: none;
  }
  
  .file-size {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  /* Loading state */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
    color: var(--text-muted);
    gap: 12px;
  }
  
  .spinner {
    width: 28px;
    height: 28px;
    border: 2px solid var(--border-subtle);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  
  /* 3D Mesh Preview Modal */
  .mesh-preview-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out;
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  
  .mesh-preview-content {
    background: var(--surface-elevated, #1a1a1f);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: scaleIn 0.2s ease-out;
    max-width: 90vw;
    max-height: 90vh;
  }
  
  @keyframes scaleIn {
    from {
      transform: scale(0.95);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  
  .mesh-preview-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
  }
  
  .mesh-preview-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #fff);
  }
  
  .mesh-filename {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .mesh-preview-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.6);
    transition: all 0.15s ease;
  }
  
  .mesh-preview-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  
  .mesh-preview-viewer {
    padding: 0;
  }
  
  .mesh-preview-actions {
    display: flex;
    justify-content: center;
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .mesh-download-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--accent-primary, #6366f1);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    transition: all 0.15s ease;
  }
  
  .mesh-download-btn:hover {
    background: var(--accent-primary-hover, #5855e0);
    transform: translateY(-1px);
  }
  
  /* Video card styles */
  .video-card-wrapper {
    position: relative;
  }
  
  .video-card {
    background: linear-gradient(145deg, #1a1a2e, #16213e);
    border: 1px solid rgba(156, 163, 175, 0.2);
  }
  
  .video-card:hover {
    border-color: rgba(147, 197, 253, 0.4);
    box-shadow: 0 4px 12px rgba(147, 197, 253, 0.2);
  }
  
  .video-thumbnail {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d12;
  }
  
  .video-thumbnail video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 6px;
  }
  
  .video-label {
    position: absolute;
    bottom: 6px;
    right: 6px;
    padding: 2px 6px;
    background: rgba(77, 166, 255, 0.9);
    color: white;
    font-size: 9px;
    font-weight: 700;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  /* Video preview modal */
  .video-preview-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
    animation: fadeIn 0.2s ease-out;
  }
  
  .video-preview-content {
    background: #1a1a2e;
    border-radius: 12px;
    border: 1px solid rgba(147, 197, 253, 0.2);
    overflow: hidden;
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }
  
  .video-preview-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    background: linear-gradient(135deg, rgba(147, 197, 253, 0.1), transparent);
    border-bottom: 1px solid rgba(147, 197, 253, 0.1);
  }
  
  .video-preview-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: white;
  }
  
  .video-filename {
    font-size: 12px;
    color: rgba(147, 197, 253, 0.8);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .video-preview-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .video-preview-close:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }
  
  .video-preview-viewer {
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d12;
  }
  
  .video-preview-viewer video {
    max-width: 512px;
    max-height: 512px;
    border-radius: 8px;
    background: black;
  }
  
  .video-preview-actions {
    display: flex;
    justify-content: center;
    padding: 16px 20px;
    border-top: 1px solid rgba(147, 197, 253, 0.1);
  }
  
  .video-download-btn-large {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: rgba(147, 197, 253, 0.2);
    color: rgba(147, 197, 253, 1);
    border: 1px solid rgba(147, 197, 253, 0.3);
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .video-download-btn-large:hover {
    background: rgba(147, 197, 253, 0.3);
    transform: translateY(-1px);
  }
</style>
