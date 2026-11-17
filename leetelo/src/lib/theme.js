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
let restoreUrl = null;

function syncThemeColorMeta(color, isDark) {
  cancelAnimationFrame(themeRaf);
  const root = document.documentElement;
  root.style.colorScheme = isDark ? 'dark' : 'light';
  const readingEl = document.getElementById('reading');
  const inReading = Boolean(readingEl && !readingEl.hidden);
  if (inReading) {
    root.style.backgroundColor = color;
    if (document.body) document.body.style.backgroundColor = color;
  } else {
    root.style.backgroundColor = '';
    if (document.body) document.body.style.backgroundColor = '';
  }

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

  if (typeof requestAnimationFrame !== 'function' || !inReading) return;
  if (restoreUrl === null && location.hash !== '#_') {
    restoreUrl = `${location.pathname}${location.search}${location.hash}`;
  }
  themeRaf = requestAnimationFrame(() => {
    for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove();
    if (!readingEl.hidden) {
      readingEl.style.transform = 'translateZ(0)';
      if (restoreUrl !== null) {
        try { history.replaceState(history.state, '', `${location.pathname}${location.search}#_`); } catch { /* ignore */ }
      }
    }
    themeRaf = requestAnimationFrame(() => {
      readingEl.style.transform = '';
      if (restoreUrl !== null) {
        const cleanUrl = restoreUrl;
        restoreUrl = null;
        if (!readingEl.hidden) {
          try { history.replaceState(history.state, '', cleanUrl); } catch { /* ignore */ }
        }
      }
      if (!head.querySelector('meta[name="theme-color"]')) {
        const fresh = document.createElement('meta');
        fresh.name = 'theme-color';
        fresh.content = color;
        head.append(fresh);
      }
    });
  });
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
