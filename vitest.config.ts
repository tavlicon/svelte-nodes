import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  
  test: {
    // Use happy-dom for fast DOM simulation (lighter than jsdom)
    environment: 'happy-dom',
    
    // Enable global test APIs (describe, it, expect) without imports
    globals: true,
    
    // Setup files run before each test file
    setupFiles: ['./src/test/setup.ts'],
    
    // Test file patterns
    include: ['src/**/*.{test,spec}.{js,ts}'],
    
    // Exclude patterns
    exclude: ['node_modules', 'dist', '.svelte-kit'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        '**/test/**',
        '**/__tests__/**',
      ],
      // Thresholds - start modest, increase over time
      thresholds: {
        statements: 20,
        branches: 20,
        functions: 20,
        lines: 20,
      },
    },
    
    // Reporter configuration
    reporters: ['default'],
    
    // Timeout for individual tests (ms)
    testTimeout: 10000,
    
    // Timeout for hooks (beforeAll, afterAll, etc.)
    hookTimeout: 10000,
  },
  
  // Resolve configuration (matches your main vite.config.ts)
  resolve: {
    alias: {
      '$lib': '/src/lib',
    },
  },
});
