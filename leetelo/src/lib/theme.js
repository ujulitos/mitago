// Theme choices: only the 3 reading palettes (Sepia, Crepúsculo, Contraste).
export const THEMES = Object.freeze(['sepia', 'twilight', 'contrast']);

const THEME_BG = {
  sepia: '#F4ECD8',
  twilight: '#111923',
  contrast: '#17181b',
};

export function resolveTheme(theme) {
  if (THEMES.includes(theme)) return theme;
  if (theme === 'crepusculo') return 'twilight';
  if (theme === 'contraste' || theme === 'dark') return 'contrast';
  if (theme === 'light') return 'sepia';
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'contrast';
    }
  } catch { /* ignore */ }
  return 'sepia';
}

// Apply a theme choice ('sepia' | 'twilight' | 'contrast') and mirror it for theme-boot.js.
export function applyTheme(theme) {
  const choice = resolveTheme(theme);
  const root = document.documentElement.dataset;
  root.theme = choice;
  delete root.paper;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[choice]);
  try {
    localStorage.setItem('rpTheme', choice);
  } catch { /* storage unavailable */ }
  return choice;
}

/** Whether the page currently renders a dark theme ('twilight' or 'contrast'). */
export function isDark() {
  const forced = document.documentElement.dataset.theme;
  return forced === 'twilight' || forced === 'contrast';
}
