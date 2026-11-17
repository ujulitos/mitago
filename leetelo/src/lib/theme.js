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

function syncThemeColorMeta(color, isDark) {
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  const head = document.head;
  if (!head) return;
  for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = color;
  head.append(meta);
}

// Apply a theme choice ('sepia' | 'twilight' | 'fog' | 'contrast' | 'wood') and mirror it for theme-boot.js.
export function applyTheme(theme) {
  const choice = resolveTheme(theme);
  const root = document.documentElement.dataset;
  root.theme = choice;
  delete root.paper;
  syncThemeColorMeta(THEME_BG[choice], choice !== 'sepia');
  try {
    localStorage.setItem('rpTheme', choice);
  } catch { /* storage unavailable */ }
  return choice;
}
