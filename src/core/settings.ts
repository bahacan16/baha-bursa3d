export type Quality = 'low' | 'medium' | 'high';
export type TimeOfDay = 'day' | 'sunset' | 'night' | 'real';

export interface Settings {
  quality: Quality;
  showFps: boolean;
  timeOfDay: TimeOfDay;
  walkSpeed: number;
  runSpeed: number;
  googleErrorTarget: number;
}

const KEY = 'nilufer-walk.settings';
const API_KEY = 'nilufer-walk.googleKey';

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return touch || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function defaultSettings(): Settings {
  const mobile = isMobileDevice();
  return {
    // KARAR: Mobilde varsayılan kalite Düşük, masaüstünde Yüksek.
    quality: mobile ? 'low' : 'high',
    showFps: false,
    timeOfDay: 'day',
    walkSpeed: 1.6,
    runSpeed: 5.5,
    googleErrorTarget: mobile ? 12 : 6,
  };
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* depolama yok (gizli pencere vb.) — sessizce geç */
  }
}

export function loadSettings(): Settings {
  const base = defaultSettings();
  const raw = safeGet(KEY);
  if (!raw) return base;
  try {
    return { ...base, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings): void {
  safeSet(KEY, JSON.stringify(s));
}

/** Google API anahtarı: localStorage, yoksa yerel geliştirme için VITE_GOOGLE_MAPS_KEY. */
export function loadApiKey(): string {
  const stored = safeGet(API_KEY);
  if (stored) return stored;
  const env = (import.meta.env?.VITE_GOOGLE_MAPS_KEY as string | undefined) ?? '';
  return env;
}

export function saveApiKey(key: string): void {
  safeSet(API_KEY, key.trim() ? key.trim() : null);
}

export function clearApiKey(): void {
  safeSet(API_KEY, null);
}
