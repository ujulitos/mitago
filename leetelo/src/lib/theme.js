// Theme choices: the 5 reading palettes (Sepia, Crepúsculo, Niebla, Contraste, Madera).
export const THEMES = Object.freeze(['sepia', 'twilight', 'fog', 'wood', 'contrast']);

const THEME_BG = {
  sepia: '#F0DEC6',
  twilight: '#2B2B2B',
  fog: '#313745',
  wood: '#17181b',
  contrast: '#000000',
};

export function resolveTheme(theme) {
  if (THEMES.includes(theme)) return theme;
  if (theme === 'crepusculo') return 'twilight';
  if (theme === 'niebla' || theme === 'mist') return 'fog';
  if (theme === 'madera') return 'wood';
  if (theme === 'contraste' || theme === 'dark') return 'contrast';
  if (theme === 'light') return 'sepia';
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'contrast';
    }
  } catch { /* ignore */ }
  return 'sepia';
}

// Apply a theme choice ('sepia' | 'twilight' | 'fog' | 'contrast' | 'wood') and mirror it for theme-boot.js.
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

/** Whether the page currently renders a dark theme ('twilight', 'fog', 'contrast' or 'wood'). */
export function isDark() {
  const forced = document.documentElement.dataset.theme;
  return forced === 'twilight' || forced === 'fog' || forced === 'contrast' || forced === 'wood';
}
