<script lang="ts">
  // Demo state for form elements
  let textValue = $state('Sample text input');
  let numberValue = $state(42);
  let textareaValue = $state('a beautiful, photograph');
  let selectValue = $state('euler');
  let sliderValue = $state(0.75);
  let stepsValue = $state(20);
  let toggleValue = $state(true);
  
  // Button states for demo
  let isLoading = $state(false);
  let hasError = $state(false);
  
  function simulateLoading() {
    isLoading = true;
    setTimeout(() => {
      isLoading = false;
    }, 2000);
  }
  
  function toggleError() {
    hasError = !hasError;
  }
</script>

<div class="components-page">
  <div class="page-header">
    <h1>Components Library</h1>
    <p class="subtitle">Reusable UI components for the Generative Design Studio</p>
  </div>
  
  <div class="components-grid">
    <!-- Form Elements Section -->
    <section class="component-section">
      <div class="section-header">
        <h2>Form Elements</h2>
        <p class="section-desc">src/lib/ui/ParameterEditor.svelte</p>
      </div>
      
      <div class="component-card">
        <div class="form-elements">
          <!-- Text Input -->
          <div class="form-group">
            <label class="form-label" for="demo-text-input">Text Input</label>
            <input
              id="demo-text-input"
              type="text"
              class="form-input"
              bind:value={textValue}
              placeholder="Enter text..."
            />
          </div>
          
          <!-- Number Input -->
          <div class="form-group">
            <label class="form-label" for="demo-number-input">Number Input</label>
            <input
              id="demo-number-input"
              type="number"
              class="form-input"
              bind:value={numberValue}
              min={0}
              max={100}
            />
          </div>
          
          <!-- Textarea -->
          <div class="form-group">
            <label class="form-label" for="demo-textarea">Textarea</label>
            <textarea
              id="demo-textarea"
              class="form-textarea"
              bind:value={textareaValue}
              placeholder="Enter prompt..."
            ></textarea>
          </div>
          
          <!-- Select / Dropdown -->
          <div class="form-group">
            <label class="form-label" for="demo-select">Select / Dropdown</label>
            <select id="demo-select" class="form-select" bind:value={selectValue}>
              <option value="euler">Euler</option>
              <option value="euler_a">Euler Ancestral</option>
              <option value="lcm">LCM</option>
              <option value="dpm">DPM++ 2M</option>
              <option value="ddim">DDIM</option>
            </select>
          </div>
          
          <!-- Slider -->
          <div class="form-group">
            <label class="form-label" for="demo-slider-denoise">Slider (Denoise)</label>
            <div class="slider-container">
              <input
                id="demo-slider-denoise"
                type="range"
                class="form-slider"
                min={0}
                max={1}
                step={0.01}
                bind:value={sliderValue}
              />
              <span class="slider-value">{sliderValue.toFixed(2)}</span>
            </div>
          </div>
          
          <!-- Slider with larger range -->
          <div class="form-group">
            <label class="form-label" for="demo-slider-steps">Slider (Steps)</label>
            <div class="slider-container">
              <input
                id="demo-slider-steps"
                type="range"
                class="form-slider"
                min={1}
                max={50}
                step={1}
                bind:value={stepsValue}
              />
              <span class="slider-value">{stepsValue}</span>
            </div>
          </div>
          
          <!-- Toggle Switch -->
          <div class="form-group">
            <label class="form-label" for="demo-toggle">Toggle Switch</label>
            <label class="form-toggle">
              <input
                id="demo-toggle"
                type="checkbox"
                bind:checked={toggleValue}
              />
              <span class="toggle-slider"></span>
              <span class="toggle-label">{toggleValue ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
        </div>
      </div>
    </section>
    
    <!-- Buttons Section -->
    <section class="component-section">
      <div class="section-header">
        <h2>Buttons</h2>
        <p class="section-desc">src/lib/ui/Toolbar.svelte & custom</p>
      </div>
      
      <div class="component-card">
        <div class="button-groups">
          <!-- Primary Actions -->
          <div class="button-group">
            <h3 class="group-title">Primary Actions</h3>
            <div class="button-row">
              <button class="btn btn-primary">
                <span class="btn-icon">+</span>
                Add Node
              </button>
              <button class="btn btn-primary" disabled>
                <span class="btn-icon">+</span>
                Disabled
              </button>
            </div>
          </div>
          
          <!-- Run / Execute -->
          <div class="button-group">
            <h3 class="group-title">Run / Execute</h3>
            <div class="button-row">
              <button class="btn-generate" onclick={simulateLoading}>
                {#if isLoading}
                  <span class="spinner spinner-dark"></span>
                  Generating...
                {:else}
                  <svg class="ai-icon" width="16" height="17" viewBox="0 0 16 17" fill="none">
                    <path d="M6.43464 3.35631L6.8932 4.63055C7.40321 6.04478 8.51676 7.15826 9.93099 7.66822L11.2053 8.12677C11.3203 8.1682 11.3203 8.33105 11.2053 8.37248L9.93099 8.83103C8.51671 9.34102 7.40319 10.4545 6.8932 11.8687L6.43464 13.1429C6.39321 13.2579 6.23035 13.2579 6.18891 13.1429L5.73035 11.8687C5.22035 10.4545 4.10679 9.341 2.69257 8.83103L1.41828 8.37248C1.30328 8.33106 1.30328 8.1682 1.41828 8.12677L2.69257 7.66822C4.10685 7.15824 5.22036 6.04472 5.73035 4.63055L6.18891 3.35631C6.23034 3.2406 6.3932 3.2406 6.43464 3.35631Z" fill="currentColor"/>
                    <path d="M12.1706 0.294462L12.4034 0.939426C12.662 1.65512 13.2255 2.21937 13.942 2.47794L14.587 2.71078C14.6455 2.7322 14.6455 2.81434 14.587 2.83506L13.942 3.0679C13.2263 3.32646 12.662 3.89 12.4034 4.60641L12.1706 5.25137C12.1491 5.30994 12.067 5.30994 12.0463 5.25137L11.8134 4.60641C11.5548 3.89072 10.9913 3.32646 10.2749 3.0679L9.62987 2.83506C9.57129 2.81363 9.57129 2.73149 9.62987 2.71078L10.2749 2.47794C10.9906 2.21937 11.5548 1.65583 11.8134 0.939426L12.0463 0.294462C12.067 0.235179 12.1498 0.235179 12.1706 0.294462Z" fill="currentColor"/>
                    <path d="M12.1706 11.251L12.4034 11.8959C12.662 12.6116 13.2255 13.1759 13.942 13.4344L14.587 13.6673C14.6455 13.6887 14.6455 13.7708 14.587 13.7916L13.942 14.0244C13.2263 14.283 12.662 14.8465 12.4034 15.5629L12.1706 16.2079C12.1491 16.2664 12.067 16.2664 12.0463 16.2079L11.8134 15.5629C11.5548 14.8472 10.9913 14.283 10.2749 14.0244L9.62987 13.7916C9.57129 13.7701 9.57129 13.688 9.62987 13.6673L10.2749 13.4344C10.9906 13.1759 11.5548 12.6123 11.8134 11.8959L12.0463 11.251C12.067 11.1924 12.1498 11.1924 12.1706 11.251Z" fill="currentColor"/>
                  </svg>
                  Generate
                {/if}
              </button>
              <button class="btn-generate" disabled>
                <svg class="ai-icon" width="16" height="17" viewBox="0 0 16 17" fill="none">
                  <path d="M6.43464 3.35631L6.8932 4.63055C7.40321 6.04478 8.51676 7.15826 9.93099 7.66822L11.2053 8.12677C11.3203 8.1682 11.3203 8.33105 11.2053 8.37248L9.93099 8.83103C8.51671 9.34102 7.40319 10.4545 6.8932 11.8687L6.43464 13.1429C6.39321 13.2579 6.23035 13.2579 6.18891 13.1429L5.73035 11.8687C5.22035 10.4545 4.10679 9.341 2.69257 8.83103L1.41828 8.37248C1.30328 8.33106 1.30328 8.1682 1.41828 8.12677L2.69257 7.66822C4.10685 7.15824 5.22036 6.04472 5.73035 4.63055L6.18891 3.35631C6.23034 3.2406 6.3932 3.2406 6.43464 3.35631Z" fill="currentColor"/>
                  <path d="M12.1706 0.294462L12.4034 0.939426C12.662 1.65512 13.2255 2.21937 13.942 2.47794L14.587 2.71078C14.6455 2.7322 14.6455 2.81434 14.587 2.83506L13.942 3.0679C13.2263 3.32646 12.662 3.89 12.4034 4.60641L12.1706 5.25137C12.1491 5.30994 12.067 5.30994 12.0463 5.25137L11.8134 4.60641C11.5548 3.89072 10.9913 3.32646 10.2749 3.0679L9.62987 2.83506C9.57129 2.81363 9.57129 2.73149 9.62987 2.71078L10.2749 2.47794C10.9906 2.21937 11.5548 1.65583 11.8134 0.939426L12.0463 0.294462C12.067 0.235179 12.1498 0.235179 12.1706 0.294462Z" fill="currentColor"/>
                  <path d="M12.1706 11.251L12.4034 11.8959C12.662 12.6116 13.2255 13.1759 13.942 13.4344L14.587 13.6673C14.6455 13.6887 14.6455 13.7708 14.587 13.7916L13.942 14.0244C13.2263 14.283 12.662 14.8465 12.4034 15.5629L12.1706 16.2079C12.1491 16.2664 12.067 16.2664 12.0463 16.2079L11.8134 15.5629C11.5548 14.8472 10.9913 14.283 10.2749 14.0244L9.62987 13.7916C9.57129 13.7701 9.57129 13.688 9.62987 13.6673L10.2749 13.4344C10.9906 13.1759 11.5548 12.6123 11.8134 11.8959L12.0463 11.251C12.067 11.1924 12.1498 11.1924 12.1706 11.251Z" fill="currentColor"/>
                </svg>
                Disabled
              </button>
              <button class="btn btn-run-legacy" onclick={simulateLoading} disabled={isLoading}>
                {#if isLoading}
                  <span class="spinner"></span>
                  Running...
                {:else}
                  <span class="btn-icon">▶</span>
                  Run
                {/if}
              </button>
              <button class="btn btn-run-legacy btn-error" onclick={toggleError}>
                <span class="btn-icon">⚠️</span>
                {hasError ? 'Clear Error' : 'Error State'}
              </button>
            </div>
          </div>
          
          <!-- Secondary Actions -->
          <div class="button-group">
            <h3 class="group-title">Secondary Actions</h3>
            <div class="button-row">
              <button class="btn btn-secondary">
                Delete
              </button>
              <button class="btn btn-secondary btn-with-shortcut">
                Undo
                <span class="shortcut">⌘Z</span>
              </button>
              <button class="btn btn-secondary btn-with-shortcut">
                Redo
                <span class="shortcut">⇧⌘Z</span>
              </button>
            </div>
          </div>
          
          <!-- Danger Actions -->
          <div class="button-group">
            <h3 class="group-title">Danger Actions</h3>
            <div class="button-row">
              <button class="btn btn-danger">
                Delete Node
              </button>
              <button class="btn btn-danger">
                Clear All
              </button>
            </div>
          </div>
          
          <!-- Icon Buttons -->
          <div class="button-group">
            <h3 class="group-title">Icon Buttons</h3>
            <div class="button-row">
              <button class="btn btn-icon-only" title="Refresh">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="btn btn-icon-only" title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="btn btn-icon-only" title="Settings">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              </button>
              <button class="btn btn-icon-only btn-icon-active" title="Theme Toggle">
                ☀️
              </button>
            </div>
          </div>
          
          <!-- Zoom / Dropdown Button -->
          <div class="button-group">
            <h3 class="group-title">Dropdown Buttons</h3>
            <div class="button-row">
              <button class="btn btn-dropdown">
                100%
                <span class="dropdown-arrow">▾</span>
              </button>
              <button class="btn btn-dropdown">
                Select Model
                <span class="dropdown-arrow">▾</span>
              </button>
            </div>
          </div>
          
          <!-- Status Indicators -->
          <div class="button-group">
            <h3 class="group-title">Status Indicators</h3>
            <div class="button-row">
              <div class="status-badge status-connected">
                <span class="status-dot"></span>
                MPS
              </div>
              <div class="status-badge status-loading">
                <span class="status-dot"></span>
                Loading...
              </div>
              <div class="status-badge status-offline">
                <span class="status-dot"></span>
                Simulation
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</div>

<style>
  .components-page {
    flex: 1;
    padding: 32px 48px;
    overflow-y: auto;
    background: var(--bg-primary);
  }
  
  .page-header {
    margin-bottom: 32px;
  }
  
  .page-header h1 {
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 32px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 8px 0;
  }
  
  .subtitle {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
  }
  
  .components-grid {
    display: flex;
    gap: 32px;
    align-items: flex-start;
  }
  
  .component-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-width: 400px;
    max-width: 500px;
  }
  
  .section-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .section-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  
  .section-desc {
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--text-muted);
    margin: 0;
  }
  
  .component-card {
    background: #141414;
    border: 0.5px solid #28282A;
    border-radius: 20px;
    padding: 24px;
  }
  
  /* Form Elements */
  .form-elements {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  
  .form-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: capitalize;
  }
  
  .form-input,
  .form-textarea,
  .form-select {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 12px;
    transition: border-color 0.15s ease;
  }
  
  .form-input:focus,
  .form-textarea:focus,
  .form-select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .form-textarea {
    min-height: 60px;
    resize: vertical;
    font-family: var(--font-mono);
  }
  
  .form-select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
  }
  
  .form-select option {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
  
  /* Slider */
  .slider-container {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .form-slider {
    flex: 1;
    height: 4px;
    appearance: none;
    background: var(--bg-tertiary);
    border-radius: 2px;
    cursor: pointer;
  }
  
  .form-slider::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--accent-primary);
    border-radius: 50%;
    cursor: grab;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }
  
  .form-slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
    box-shadow: 0 0 6px var(--accent-glow);
  }
  
  .form-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: var(--accent-primary);
    border: none;
    border-radius: 50%;
    cursor: grab;
  }
  
  .slider-value {
    min-width: 40px;
    padding: 3px 6px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-family: var(--font-mono);
    text-align: center;
    color: var(--text-primary);
  }
  
  /* Toggle */
  .form-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  
  .form-toggle input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }
  
  .toggle-slider {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    transition: all 0.2s ease;
  }
  
  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    left: 2px;
    top: 2px;
    background: var(--text-secondary);
    border-radius: 50%;
    transition: all 0.2s ease;
  }
  
  .form-toggle input:checked + .toggle-slider {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  
  .form-toggle input:checked + .toggle-slider::before {
    transform: translateX(20px);
    background: white;
  }
  
  .toggle-label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  
  /* Buttons */
  .button-groups {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .button-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .group-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0;
  }
  
  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  
  /* Base Button */
  .btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .btn:hover:not(:disabled) {
    background: var(--bg-elevated);
    border-color: var(--border-default);
  }
  
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  
  .btn-icon {
    font-size: 14px;
    font-weight: 600;
  }
  
  /* Primary Button */
  .btn-primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: white;
  }
  
  .btn-primary:hover:not(:disabled) {
    background: var(--accent-secondary);
    border-color: var(--accent-secondary);
  }
  
  /* Run Button */
  /* New Generate Button - Pill style */
  .btn-generate {
    display: inline-flex;
    height: 48px;
    padding: 12px 24px 12px 16px;
    justify-content: center;
    align-items: center;
    gap: 8px;
    border-radius: 100px;
    background: var(--bb-volt-85, #DCFDB5);
    border: none;
    color: #111111;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 18px;
    font-weight: 400;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .btn-generate:hover:not(:disabled) {
    background: var(--bb-volt-75, #c9f59a);
  }
  
  .btn-generate:active:not(:disabled) {
    transform: scale(0.98);
  }
  
  .btn-generate:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .ai-icon {
    width: 16px;
    height: 17px;
    flex-shrink: 0;
  }
  
  .spinner-dark {
    border-color: rgba(0, 0, 0, 0.2);
    border-top-color: #111111;
  }
  
  /* Legacy Run Button */
  .btn-run-legacy {
    background: #10b981;
    border-color: #10b981;
    color: white;
  }
  
  .btn-run-legacy:hover:not(:disabled) {
    background: #059669;
    border-color: #059669;
  }
  
  .btn-run-legacy.btn-error {
    background: #ef4444;
    border-color: #ef4444;
  }
  
  .btn-run-legacy.btn-error:hover {
    background: #dc2626;
    border-color: #dc2626;
  }
  
  /* Secondary Button */
  .btn-secondary {
    background: var(--bg-tertiary);
    border-color: var(--border-subtle);
  }
  
  .btn-with-shortcut {
    gap: 8px;
  }
  
  .shortcut {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: system-ui, -apple-system, sans-serif;
  }
  
  /* Danger Button */
  .btn-danger {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
  
  .btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.5);
  }
  
  /* Icon Button */
  .btn-icon-only {
    padding: 8px;
    min-width: 36px;
    justify-content: center;
  }
  
  .btn-icon-only svg {
    width: 16px;
    height: 16px;
  }
  
  .btn-icon-active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  
  /* Dropdown Button */
  .btn-dropdown {
    min-width: 100px;
    justify-content: space-between;
  }
  
  .dropdown-arrow {
    font-size: 10px;
    opacity: 0.6;
    margin-left: 4px;
  }
  
  /* Spinner */
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Status Badge */
  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f59e0b;
  }
  
  .status-connected .status-dot {
    background: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
  }
  
  .status-connected {
    color: #10b981;
  }
  
  .status-loading .status-dot {
    background: #3b82f6;
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  .status-loading {
    color: #3b82f6;
  }
  
  .status-offline .status-dot {
    background: #f59e0b;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
