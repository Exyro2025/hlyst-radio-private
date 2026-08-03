// Station-wide theme application.
//
// The operator picks one theme in admin → Settings → Theme; every listener
// renders with that theme's token map. The controller serves the registry at
// /themes (token maps) and the active id rides along on every /state poll.
//
// On boot we apply a cached token blob from localStorage *before paint* via
// THEME_INIT_SCRIPT so there's no flash. Once /themes responds, the fresh
// token map is applied + cached for the next visit.

import { THEME_TOKEN_KEYS, type DisplayFontId, type MonoFontId } from './theme-tokens.generated';

const TOKEN_KEY_SET = new Set<string>(THEME_TOKEN_KEYS);
const TOKEN_CACHE_KEY = 'subwave-theme-tokens';
const OVERRIDE_KEY = 'subwave-theme-override';

// A theme stores --display-font / --mono-font as a curated id; resolve it to a
// real family stack here (the stacks reference next/font variables set in
// app/layout.tsx). Keyed by DisplayFontId | MonoFontId so TypeScript fails the
// build if either curated set grows without a matching stack.
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

/** Resolve a font-token value (--display-font / --mono-font): a curated id →
 *  its family stack, or the value unchanged (already a stack, or unset). Used
 *  by the theme builder's live preview to render sample text in the picked face. */
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

/** Write a theme's tokens onto the document root and set `data-theme=mode`
 *  so any CSS rules keyed off the attribute (shadcn's `dark:` variant, the
 *  paper-grain blend mode) still resolve. Keys outside the allowlist are
 *  silently ignored — the controller already filters them, but we double-check
 *  on the client too. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  // Clear the whole allowlist first: a token the incoming theme omits must fall
  // back to its :root default (paper grain, Fraunces/JetBrains), not linger
  // from the previously applied theme.
  for (const key of THEME_TOKEN_KEYS) html.style.removeProperty(key);
  for (const [k, v] of Object.entries(theme.tokens)) {
    if (!TOKEN_KEY_SET.has(k)) continue;
    const value = FONT_TOKEN_KEYS.has(k) ? resolveFont(v) : v;
    html.style.setProperty(k, value);
  }
  html.setAttribute('data-theme', theme.mode);
  syncDarkClass(theme.mode);
}

/** Keep the shadcn-convention `.dark` class in sync with the resolved mode.
 *  SUB/WAVE's Tailwind `dark:` variant keys off `[data-theme='dark']` (see
 *  globals.css `@custom-variant dark`), so this class is not what drives the
 *  palette — it's mirrored so the app also reads as dark to tooling and shadcn
 *  primitives that expect the `.dark` class. */
function syncDarkClass(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

/** Drop every palette token from the document root so the built-in light/dark
 *  base in globals.css (`:root` / `:root[data-theme="dark"]`) paints instead.
 *  Only reachable when the registry is empty — the palette's tokens are written
 *  as *inline* styles on <html> and would otherwise beat the base rules. */
function clearThemeTokens(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  for (const key of THEME_TOKEN_KEYS) html.style.removeProperty(key);
}

/** What `prefers-color-scheme` currently reports. */
function systemMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** What the document should end up rendering, given the registry and the
 *  listener's palette override. */
export interface ResolvedAppearance {
  /** The palette to paint, or null to fall back to the built-in base — which
   *  only happens when the registry is empty. */
  theme: Theme | null;
}

/** Resolve which palette paints. Pure — `applyAppearance` does the DOM work.
 *
 *  Precedence: the listener's override beats the station's active palette beats
 *  the first registry entry.
 *
 *  Light vs dark is not a separate axis. Every theme declares the mode it was
 *  authored for, and a palette is a hand-picked set of surfaces, ink, and
 *  accents that only holds together in that mode — repainting one into the
 *  other produces mud. A listener who wants dark picks a dark theme. */
export function resolveAppearance(
  registry: Theme[],
  stationId: string | null,
  override: string | null,
): ResolvedAppearance {
  const byId = (id: string | null) => (id ? registry.find(t => t.id === id) : undefined);
  return { theme: byId(override) ?? byId(stationId) ?? registry[0] ?? null };
}

/** Paint a resolved appearance onto the document root. */
export function applyAppearance(resolved: ResolvedAppearance): void {
  if (typeof document === 'undefined') return;
  if (resolved.theme) {
    applyTheme(resolved.theme);
    return;
  }
  // No palette to paint — hand the document back to `prefers-color-scheme`.
  clearThemeTokens();
  document.documentElement.removeAttribute('data-theme');
  syncDarkClass(systemMode());
}

/** Cache the theme so the next page load can apply it pre-paint via
 *  THEME_INIT_SCRIPT. Stored as JSON keyed by `subwave-theme-tokens`. */
export function cacheTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(theme));
  } catch { /* private mode / quota — non-fatal */ }
}

/** Cache whatever was actually painted, so the pre-paint script reproduces it
 *  exactly. A resolution that lands on the built-in base (empty registry) drops
 *  the cache rather than leaving a stale palette for the script to apply. */
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

/** Read the listener's per-browser theme override id. When set, the
 *  ThemeProvider applies this theme instead of the station's active one — so
 *  a listener can pick a palette they prefer without affecting anyone else.
 *  Returns null when no override is stored or storage is unreadable. */
export function loadThemeOverride(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Save or clear the listener's per-browser theme override. Pass null to
 *  drop the override and re-follow the station default. Failures (private
 *  mode, quota) are swallowed — the override is a nice-to-have, not load-
 *  bearing. */
export function saveThemeOverride(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(OVERRIDE_KEY, id);
    else window.localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* private mode / quota — non-fatal */ }
}

// Pre-hydration <script> body — applies the cached theme's tokens onto <html>
// before paint so listeners never see a flash. The body is a static constant,
// inlined into layout.tsx via dangerouslySetInnerHTML; no untrusted input
// reaches it.
//
// The key list + font stacks are inlined from the generated registry mirror, so
// adding a token there (and a :root fallback in globals.css) flows here with a
// regenerate — no hand-editing this script.
export const THEME_INIT_SCRIPT = `
  try {
    var html = document.documentElement;
    var raw = localStorage.getItem('${TOKEN_CACHE_KEY}');
    var t = raw ? JSON.parse(raw) : null;
    var usePalette = !!(t && t.tokens);
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
    var resolved = usePalette && (t.mode === 'light' || t.mode === 'dark') ? t.mode : null;
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
