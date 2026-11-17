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

const HOME_BG = {
  sepia: '#F0DEC6',
  twilight: '#17181b',
  fog: '#313745',
  wood: '#2B2B2B',
  contrast: '#000000',
};

let themeRaf = 0;
let restoreUrl = null;

function syncThemeColorMeta(choice) {
  cancelAnimationFrame(themeRaf);
  const root = document.documentElement;
  const readingEl = document.getElementById('reading');
  const inReading = Boolean(readingEl && !readingEl.hidden);
  const color = (inReading ? THEME_BG[choice] : HOME_BG[choice]) || THEME_BG[choice];
  const isDark = choice !== 'sepia';

  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.style.backgroundColor = color;
  if (document.body) document.body.style.backgroundColor = color;

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

  if (typeof requestAnimationFrame !== 'function') return;
  const activeLayer = inReading ? readingEl : document.querySelector('.lib-head');
  const drawerEl = !inReading ? document.getElementById('lib-drawer') : null;
  if (restoreUrl === null && location.hash !== '#_') {
    restoreUrl = `${location.pathname}${location.search}${location.hash}`;
  }
  themeRaf = requestAnimationFrame(() => {
    for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove();
    if (activeLayer && !activeLayer.hidden) {
      activeLayer.style.backgroundColor = color;
      activeLayer.style.transform = 'translateZ(0)';
    }
    // Menú abierto: se oculta el menú un instante (igual que al cerrarlo, que es cuando el navegador sí
    // actualiza la barra superior) y se vuelve a mostrar enseguida.
    if (drawerEl && !drawerEl.hidden) drawerEl.style.visibility = 'hidden';
    if (restoreUrl !== null) {
      try { history.replaceState(history.state, '', `${location.pathname}${location.search}#_`); } catch { /* ignore */ }
    }
    themeRaf = requestAnimationFrame(() => {
      if (activeLayer) {
        activeLayer.style.transform = '';
        if (!inReading) activeLayer.style.backgroundColor = '';
      }
      if (restoreUrl !== null) {
        const cleanUrl = restoreUrl;
        restoreUrl = null;
        try { history.replaceState(history.state, '', cleanUrl); } catch { /* ignore */ }
      }
      if (!head.querySelector('meta[name="theme-color"]')) {
        const fresh = document.createElement('meta');
        fresh.name = 'theme-color';
        fresh.content = color;
        head.append(fresh);
      }
      if (drawerEl) setTimeout(() => { drawerEl.style.visibility = ''; }, 140);
    });
  });
}

// Apply a theme choice ('sepia' | 'twilight' | 'fog' | 'contrast' | 'wood') and mirror it for theme-boot.js.
export function applyTheme(theme) {
  const choice = resolveTheme(theme);
  const root = document.documentElement.dataset;
  root.theme = choice;
  delete root.paper;
  syncThemeColorMeta(choice);
  try {
    localStorage.setItem('rpTheme', choice);
  } catch { /* storage unavailable */ }
  return choice;
}
