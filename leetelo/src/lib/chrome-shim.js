import EN from './i18n-en.js';
import ES from './i18n-es.js';

const storageKey = (key) => `rp-webapp:${key}`;

// In-memory fallback if localStorage is disabled or throws (e.g. strict private mode)
const memoryStorage = new Map();

const readStored = async (key, fallback = undefined) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey(key));
      if (raw === null) return fallback;
      return JSON.parse(raw);
    }
  } catch {
    // fallback to memory
  }
  return memoryStorage.has(key) ? memoryStorage.get(key) : fallback;
};

const writeStored = async (obj) => {
  try {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey(key));
        memoryStorage.delete(key);
      } else {
        if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(key), JSON.stringify(value));
        memoryStorage.set(key, value);
      }
    }
  } catch {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) memoryStorage.delete(key);
      else memoryStorage.set(key, value);
    }
  }
};

const getLocaleMessages = () => {
  try {
    const lang = (navigator.language || 'es').toLowerCase().split('-')[0];
    return lang === 'en' ? EN : ES;
  } catch {
    return ES;
  }
};

const browserLike = {
  i18n: {
    getUILanguage: () => {
      try {
        return (navigator.language || 'es').split('-')[0] || 'es';
      } catch {
        return 'es';
      }
    },
    getMessage: (key, substitutions = []) => {
      const catalog = getLocaleMessages();
      const text = catalog[key] ?? EN[key];
      if (text === undefined) return key;
      const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
      return String(text).replace(/\$(?:P)?(\d)\$?/g, (_, n) => String(subs[Number(n) - 1] ?? ''));
    },
  },
  runtime: {
    id: 'leetelo-webapp',
    getManifest: () => ({ name: 'Léetelo Web', default_locale: 'es', version: '1.1.1' }),
    getURL: (path) => {
      if (!path) return '';
      if (/^https?:\/\//i.test(path)) return path;
      const clean = String(path).replace(/^\/+/, '');
      try {
        return new URL(clean, window.location.href).href;
      } catch {
        return `/${clean}`;
      }
    },
  },
  extension: {
    isAllowedFileSchemeAccess: async () => true,
  },
  tabs: {
    create: async ({ url }) => {
      if (typeof window !== 'undefined' && url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
  },
  permissions: {
    contains: async () => true,
    request: async () => true,
  },
  storage: {
    local: {
      get: async (key) => {
        const keys = Array.isArray(key) ? key : [key];
        const out = {};
        for (const k of keys) out[k] = await readStored(k, undefined);
        return out;
      },
      set: async (obj) => writeStored(obj),
    },
  },
  contextMenus: {
    removeAll: () => undefined,
    create: () => undefined,
  },
  declarativeNetRequest: {
    updateDynamicRules: async () => undefined,
    removeRules: async () => undefined,
  },
  action: {},
};

// Safe attachment that never fails in Chrome desktop, mobile, Safari or Firefox
const g = globalThis;
if (!g.chrome) {
  try {
    g.chrome = browserLike;
  } catch {
    // ignore
  }
}

if (g.chrome) {
  for (const [key, val] of Object.entries(browserLike)) {
    try {
      if (!g.chrome[key]) {
        g.chrome[key] = val;
      } else if (typeof val === 'object' && val !== null) {
        for (const [subKey, subVal] of Object.entries(val)) {
          if (!g.chrome[key][subKey]) {
            g.chrome[key][subKey] = subVal;
          }
        }
      }
    } catch {
      try {
        Object.defineProperty(g.chrome, key, {
          value: val,
          configurable: true,
          writable: true,
          enumerable: true,
        });
      } catch {
        // ignore
      }
    }
  }
}

export default browserLike;
