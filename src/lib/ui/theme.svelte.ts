/**
 * Theme store for light/dark mode
 */

type Theme = 'light' | 'dark';

// Check localStorage for saved preference, default to dark
function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  }
  return 'dark'; // Default to dark mode
}

let current = $state<Theme>(getInitialTheme());

function toggle() {
  current = current === 'light' ? 'dark' : 'light';
  if (typeof window !== 'undefined') {
    localStorage.setItem('theme', current);
  }
}

function setTheme(newTheme: Theme) {
  current = newTheme;
  if (typeof window !== 'undefined') {
    localStorage.setItem('theme', current);
  }
}

export const theme = {
  get current() { return current; },
  get isDark() { return current === 'dark'; },
  get isLight() { return current === 'light'; },
  toggle,
  setTheme,
};
