/**
 * Simple page router for the app
 */

export type Page = 'canvas' | 'panels' | 'components';

// Create a reactive store for the current page
class Router {
  currentPage = $state<Page>('panels');
  
  get page() {
    return this.currentPage;
  }
  
  navigate(page: Page) {
    this.currentPage = page;
    // Update URL hash for bookmarkability
    window.location.hash = page;
  }
  
  init() {
    // Check URL hash on init
    const hash = window.location.hash.slice(1) as Page;
    if (hash === 'canvas' || hash === 'panels' || hash === 'components') {
      this.currentPage = hash;
    }
    
    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.slice(1) as Page;
      if (hash === 'canvas' || hash === 'panels' || hash === 'components') {
        this.currentPage = hash;
      }
    });
  }
}

export const router = new Router();
