/**
 * Simple page router for the app
 * Supports nested routes for UI component documentation
 */

export type Page = 'canvas' | 'ui' | 'ui/components' | 'ui/panels';

// Valid pages for routing
const validPages: Page[] = ['canvas', 'ui', 'ui/components', 'ui/panels'];

function isValidPage(value: string): value is Page {
  return validPages.includes(value as Page);
}

// Create a reactive store for the current page
class Router {
  currentPage = $state<Page>('canvas');
  
  get page() {
    return this.currentPage;
  }
  
  // Check if current page is under /ui section
  get isUISection() {
    return this.currentPage.startsWith('ui');
  }
  
  navigate(page: Page) {
    this.currentPage = page;
    // Update URL hash for bookmarkability
    window.location.hash = page;
  }
  
  init() {
    // Check URL hash on init
    const hash = window.location.hash.slice(1);
    if (isValidPage(hash)) {
      this.currentPage = hash;
    }
    
    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.slice(1);
      if (isValidPage(hash)) {
        this.currentPage = hash;
      }
    });
  }
}

export const router = new Router();
