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

let themeRaf = 0;

function syncThemeColorMeta(color, isDark) {
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  const head = document.head;
  if (!head) return;
  let existing = head.querySelector('meta[name="theme-color"]');
  if (existing) {
    existing.setAttribute('content', color);
  } else {
    existing = document.createElement('meta');
    existing.name = 'theme-color';
    existing.content = color;
    head.append(existing);
  }
  if (typeof requestAnimationFrame === 'function') {
    cancelAnimationFrame(themeRaf);
    themeRaf = requestAnimationFrame(() => {
      for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove();
      const fresh = document.createElement('meta');
      fresh.name = 'theme-color';
      fresh.content = color;
      head.append(fresh);
      const readingEl = document.getElementById('reading');
      if (readingEl && !readingEl.hidden) {
        try {
          history.replaceState(history.state, '', location.href);
        } catch { /* ignore */ }
      }
    });
  }
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
