// The controller serves the theme registry at /themes; the active id rides on
// every /state poll. A cached token blob is applied pre-paint via
// THEME_INIT_SCRIPT so there's no flash before /themes responds.

import { THEME_TOKEN_KEYS, type DisplayFontId, type MonoFontId } from './theme-tokens.generated';

const TOKEN_KEY_SET = new Set<string>(THEME_TOKEN_KEYS);
const TOKEN_CACHE_KEY = 'subwave-theme-tokens';
const OVERRIDE_KEY = 'subwave-theme-override';
// A listener's explicit light/dark choice, independent of the active palette.
// When set it steers which palette is picked — see resolveAppearance.
const MODE_KEY = 'subwave-mode-override';

// Themes store --display-font / --mono-font as a curated id, resolved to a real
// family stack here (stacks reference next/font variables set in app/layout.tsx).
// Keyed by DisplayFontId | MonoFontId so the build fails if either curated set
// grows without a matching stack.
const FONT_STACKS: Record<DisplayFontId | MonoFontId, string> = {
  // display faces (--display-font)
  'fraunces': 'var(--font-fraunces), Georgia, serif',
  'doto': 'var(--font-doto), var(--font-jetbrains), monospace',
  'space-grotesk': 'var(--font-space-grotesk), var(--font-sans), sans-serif',
  'instrument-serif': 'var(--font-instrument-serif), Georgia, serif',
  'anton': 'var(--font-anton), var(--font-space-grotesk), sans-serif',
  'chakra-petch': 'var(--font-chakra-petch), var(--font-sans), sans-serif',
  'saira-stencil-one': 'var(--font-saira-stencil-one), var(--font-space-grotesk), sans-serif',
  // mono faces (--mono-font)
  'jetbrains': 'var(--font-jetbrains), ui-monospace, monospace',
  'ibm-plex-mono': 'var(--font-ibm-plex-mono), ui-monospace, monospace',
  'space-mono': 'var(--font-space-mono), ui-monospace, monospace',
  'fira-code': 'var(--font-fira-code), ui-monospace, monospace',
  'courier-prime': 'var(--font-courier-prime), "Courier New", monospace',
  'overpass-mono': 'var(--font-overpass-mono), ui-monospace, monospace',
};

// Token keys whose value is a curated font id (resolved to a family stack).
const FONT_TOKEN_KEYS = new Set(['--display-font', '--mono-font']);

/** Curated font id → family stack; any other value passes through unchanged. */
export function resolveFont(id: string): string {
  return FONT_STACKS[id as DisplayFontId | MonoFontId] ?? id;
}

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  id: string;
  name: string;
  description?: string;
  mode: ThemeMode;
  tokens: Record<string, string>;
}

/** Write a theme's tokens onto the document root and set `data-theme=mode` so
 *  CSS rules keyed off the attribute (shadcn's `dark:` variant, the paper-grain
 *  blend mode) resolve. Keys outside the allowlist are ignored. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  // Clear the whole allowlist first: a token the incoming theme omits must fall
  // back to its :root default, not linger from the previous theme.
  for (const key of THEME_TOKEN_KEYS) html.style.removeProperty(key);
  for (const [k, v] of Object.entries(theme.tokens)) {
    if (!TOKEN_KEY_SET.has(k)) continue;
    const value = FONT_TOKEN_KEYS.has(k) ? resolveFont(v) : v;
    html.style.setProperty(k, value);
  }
  html.setAttribute('data-theme', theme.mode);
  syncDarkClass(theme.mode);
}

/** Mirror the resolved mode onto the shadcn-convention `.dark` class. The
 *  Tailwind `dark:` variant keys off `[data-theme='dark']` (globals.css
 *  `@custom-variant dark`), so this class drives nothing here — it exists for
 *  shadcn primitives and tooling that expect `.dark`. */
function syncDarkClass(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

/** Drop every palette token so the built-in base in globals.css (`:root` /
 *  `:root[data-theme="dark"]`) paints instead. Load-bearing for the mode
 *  override: `applyTheme` writes the palette as *inline* styles, which beat the
 *  `:root[data-theme="dark"]` rule, so flipping the attribute alone leaves
 *  surfaces in the palette's own mode while `dark:` utilities flip underneath. */
function clearThemeTokens(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  for (const key of THEME_TOKEN_KEYS) html.style.removeProperty(key);
}

/** Pin an explicit light/dark mode. Only meaningful once the palette's inline
 *  tokens are out of the way — see `clearThemeTokens`. */
function applyMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  syncDarkClass(mode);
}

/** Hand the document back to `prefers-color-scheme` by dropping `data-theme`,
 *  so the media-query block in globals.css applies. */
function clearMode(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-theme');
  syncDarkClass(systemMode());
}

export function systemMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface ResolvedAppearance {
  /** The palette to paint, or null to fall back to the built-in base — which
   *  happens when a mode is pinned and no registry palette renders in it. */
  theme: Theme | null;
  /** The mode to pin, or null to follow `prefers-color-scheme`. */
  mode: ThemeMode | null;
}

/** Resolve palette + mode together. Pure — `applyAppearance` does the DOM work.
 *
 *  Palette precedence: listener override > station active > first registry
 *  entry. A pinned mode then keeps that palette only if it was authored for
 *  that mode; otherwise the palette is paused in favour of the built-in base.
 *  Don't recolour a palette into the other mode — palettes only hold together
 *  in the mode they were written for, and swapping in a different one would
 *  leave the picker highlighting a row that isn't on screen. */
export function resolveAppearance(
  registry: Theme[],
  stationId: string | null,
  override: string | null,
  modeOverride: ThemeMode | null,
): ResolvedAppearance {
  const byId = (id: string | null) => (id ? registry.find(t => t.id === id) : undefined);
  const base = byId(override) ?? byId(stationId) ?? registry[0] ?? null;

  if (!modeOverride) return { theme: base, mode: base ? base.mode : null };
  if (base && base.mode === modeOverride) return { theme: base, mode: modeOverride };
  return { theme: null, mode: modeOverride };
}

export function applyAppearance(resolved: ResolvedAppearance): void {
  if (typeof document === 'undefined') return;
  if (resolved.theme) {
    applyTheme(resolved.theme);
    return;
  }
  clearThemeTokens();
  if (resolved.mode) applyMode(resolved.mode);
  else clearMode();
}

export function loadModeOverride(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MODE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

/** Pass null to clear the override. */
export function saveModeOverride(mode: ThemeMode | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (mode) window.localStorage.setItem(MODE_KEY, mode);
    else window.localStorage.removeItem(MODE_KEY);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Cache the theme so the next load can apply it pre-paint via
 *  THEME_INIT_SCRIPT. */
export function cacheTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(theme));
  } catch { /* private mode / quota — non-fatal */ }
}

/** Cache whatever was actually painted so the pre-paint script reproduces it.
 *  Landing on the built-in base drops the cache rather than leaving a stale
 *  palette for the script to apply. */
export function cacheAppearance(resolved: ResolvedAppearance): void {
  if (typeof window === 'undefined') return;
  if (resolved.theme) {
    cacheTheme(resolved.theme);
    return;
  }
  try {
    window.localStorage.removeItem(TOKEN_CACHE_KEY);
  } catch { /* private mode / quota — non-fatal */ }
}

/** The listener's per-browser theme override id, applied instead of the
 *  station's active theme. Null when unset or storage is unreadable. */
export function loadThemeOverride(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Pass null to drop the override and re-follow the station default. Storage
 *  failures are swallowed — the override is not load-bearing. */
export function saveThemeOverride(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(OVERRIDE_KEY, id);
    else window.localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* private mode / quota — non-fatal */ }
}

// Pre-hydration <script> body: applies the cached tokens onto <html> before
// paint so listeners never see a flash. Static constant, inlined into
// layout.tsx via dangerouslySetInnerHTML — no untrusted input reaches it.
// Key list + font stacks come from the generated registry mirror, so a new
// token flows here on regenerate; never hand-edit this script.
export const THEME_INIT_SCRIPT = `
  try {
    var html = document.documentElement;
    var mode = localStorage.getItem('${MODE_KEY}');
    if (mode !== 'light' && mode !== 'dark') mode = null;
    var raw = localStorage.getItem('${TOKEN_CACHE_KEY}');
    var t = raw ? JSON.parse(raw) : null;
    // Mirrors resolveAppearance: a pinned mode keeps the cached palette only if
    // authored for it. Applying the tokens and then flipping data-theme would
    // leave inline light surfaces under dark rules.
    var usePalette = t && t.tokens && (!mode || t.mode === mode);
    if (usePalette) {
      var keys = ${JSON.stringify([...THEME_TOKEN_KEYS])};
      var fonts = ${JSON.stringify(FONT_STACKS)};
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = t.tokens[k];
        if (typeof v === 'string') {
          if ((k === '--display-font' || k === '--mono-font') && fonts[v]) v = fonts[v];
          html.style.setProperty(k, v);
        }
      }
    }
    var resolved = mode || (usePalette && (t.mode === 'light' || t.mode === 'dark') ? t.mode : null);
    if (resolved) html.setAttribute('data-theme', resolved);
    else html.removeAttribute('data-theme');
    html.classList.toggle(
      'dark',
      resolved
        ? resolved === 'dark'
        : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches),
    );
  } catch (e) {}
`;
