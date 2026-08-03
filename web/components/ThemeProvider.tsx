'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyAppearance,
  cacheAppearance,
  loadThemeOverride,
  saveThemeOverride,
  resolveAppearance,
  type Theme,
} from '@/lib/theme';
// Install-level concern: the theme registry belongs to *this* deployment, so
// this always goes through the same-origin default client — never a showcase
// station's origin.
import { defaultStationClient } from '@/lib/stationClient';

interface ThemeContextValue {
  /** Every theme the controller knows about (built-ins + state/themes/*.json). */
  themes: Theme[];
  /** The station's active theme id — what every listener without an override sees. */
  stationActiveId: string | null;
  /** Per-browser override id, or null when none is set. */
  overrideId: string | null;
  /** Effective theme *selection* (override if set + still in registry, else
   *  station). This is what the picker highlights and what `t` cycles from. */
  effectiveId: string | null;
  /** Save or clear the override and re-apply immediately. null clears it. */
  setOverride: (id: string | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Read theme state from any client component. Returns null on the server
 *  and before the provider is mounted. */
export function useThemeSwitcher(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

// Single, app-wide theme syncer + provider. Mounted from the root layout so
// every page (player, admin, landing, onboarding, setup-guide) gets the
// station-wide theme without each one having to wire up a fetcher.
//
// The pre-paint <script> in layout.tsx already applied the cached appearance,
// so this only handles:
//   1. First visit (no cache) — fetch + apply + populate cache.
//   2. Operator changed the theme in admin since the last visit — refresh.
//   3. A listener override beats the station — apply it whenever it exists in
//      the live registry. Stale ids (theme deleted under our feet) silently
//      fall back to the station active.
//
// Light vs dark is a property of the palette, not a separate listener control:
// each theme declares its own mode and a listener who wants dark picks a dark
// theme. There is no per-browser mode pin and no `d` hotkey.
//
// 30 s poll cadence is the upper bound on how long a listener sees the old
// theme after an operator switch. Cheap call (returns a tiny JSON blob);
// every-5s would be wasteful and every-N-minutes feels stale.
export default function ThemeProvider({ children }: { children?: ReactNode }) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [stationActiveId, setStationActiveId] = useState<string | null>(null);
  const [overrideId, setOverrideIdState] = useState<string | null>(null);

  // Read the override on mount so SSR can render through cleanly — localStorage
  // is only safe to touch in an effect. The pre-paint <script> already painted
  // the right tokens, so a one-tick lag in state is invisible.
  useEffect(() => {
    setOverrideIdState(loadThemeOverride());
  }, []);

  // Hold the latest themes + override in refs so the polling loop can resolve
  // the effective appearance without re-creating itself on every state change.
  const themesRef = useRef<Theme[]>(themes);
  const overrideRef = useRef<string | null>(overrideId);
  themesRef.current = themes;
  overrideRef.current = overrideId;

  // Resolve + paint + cache from the latest registry and the override. The
  // single place appearance reaches the DOM.
  const applyEffective = useCallback(
    (registry: Theme[], stationId: string | null, override: string | null) => {
      const resolved = resolveAppearance(registry, stationId, override);
      applyAppearance(resolved);
      cacheAppearance(resolved);
    },
    [],
  );

  // Poll /themes on mount + every 30s. The effect is parameterless so it
  // doesn't restart on every override change — the overrides are read from
  // refs inside the fetch.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const j = await defaultStationClient.themes();
        if (cancelled) return;
        setThemes(j.themes);
        setStationActiveId(j.active);
        applyEffective(j.themes, j.active, overrideRef.current);
      } catch {
        // Network blip — keep the existing CSS variables. The next poll will
        // sort it out, and the pre-paint cache covers the meantime.
      }
    };

    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [applyEffective]);

  // Public setter the switcher buttons call. Persists to localStorage, updates
  // local state, and applies the theme without waiting for the next poll.
  const setOverride = useCallback(
    (id: string | null) => {
      saveThemeOverride(id);
      overrideRef.current = id;
      setOverrideIdState(id);
      applyEffective(themesRef.current, stationActiveId, id);
    },
    [applyEffective, stationActiveId],
  );

  // The resolved effective id — what the picker highlights as "active".
  // Mirrors resolveAppearance's palette precedence so context consumers don't
  // need to re-implement it.
  const effectiveId =
    (overrideId && themes.some(t => t.id === overrideId) ? overrideId : stationActiveId) ?? null;

  return (
    <ThemeContext.Provider
      value={{
        themes,
        stationActiveId,
        overrideId,
        effectiveId,
        setOverride,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
