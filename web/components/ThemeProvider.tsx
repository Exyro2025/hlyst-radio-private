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
  loadModeOverride,
  saveModeOverride,
  resolveAppearance,
  systemMode,
  type Theme,
  type ThemeMode,
} from '@/lib/theme';
// The theme registry belongs to *this* deployment, so always the same-origin
// default client — never a showcase station's origin.
import { defaultStationClient } from '@/lib/stationClient';

interface ThemeContextValue {
  themes: Theme[];
  stationActiveId: string | null;
  overrideId: string | null;
  /** The listener's theme *selection* — what the picker highlights. Stays their
   *  choice even while a pinned mode pauses the palette. */
  effectiveId: string | null;
  /** The palette actually on screen, or null when a pinned mode paused it in
   *  favour of the built-in base. Differs from `effectiveId` only when paused. */
  paintedId: string | null;
  setOverride: (id: string | null) => void;
  /** Pinned light/dark mode, or null when following the palette / system ("auto"). */
  mode: ThemeMode | null;
  renderedMode: ThemeMode;
  setMode: (mode: ThemeMode | null) => void;
  /** Lands back on auto whenever auto would render the mode being asked for, so
   *  a single keypress can never permanently pin the listener. */
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Null on the server and before the provider is mounted. */
export function useThemeSwitcher(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

// Bare-letter shortcuts must never fire while the listener is entering text.
// Radix Select/DropdownMenu content is a div with a listbox/menu role, not a
// <select>, and runs its own first-letter typeahead, so a `d` inside one
// belongs to the widget.
const TYPEAHEAD_CONTAINERS =
  '[role="listbox"],[role="menu"],[role="menubar"],[role="tree"],[role="grid"],[role="combobox"]';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return !!target.closest(TYPEAHEAD_CONTAINERS);
}

// Single app-wide theme syncer, mounted from the root layout. The pre-paint
// <script> in layout.tsx already applied the cached appearance, so this covers
// first visit, operator theme changes, listener overrides (a stale id falls
// back to the station active), and a pinned light/dark mode.
//
// The 30s poll cadence is the upper bound on how long a listener sees the old
// theme after an operator switch.
export default function ThemeProvider({ children }: { children?: ReactNode }) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [stationActiveId, setStationActiveId] = useState<string | null>(null);
  const [overrideId, setOverrideIdState] = useState<string | null>(null);
  const [mode, setModeState] = useState<ThemeMode | null>(null);
  const [paintedId, setPaintedId] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(false);

  // localStorage is only safe to touch in an effect. The pre-paint <script>
  // already painted the right tokens + mode, so the one-tick lag is invisible.
  useEffect(() => {
    setOverrideIdState(loadThemeOverride());
    setModeState(loadModeOverride());
  }, []);

  // The CSS repaints itself off the media query; this only exists so the UI can
  // *say* which way auto went.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Refs so the polling loop can resolve the effective appearance without
  // re-creating itself on every state change.
  const themesRef = useRef<Theme[]>(themes);
  const overrideRef = useRef<string | null>(overrideId);
  const modeRef = useRef<ThemeMode | null>(mode);
  themesRef.current = themes;
  overrideRef.current = overrideId;
  modeRef.current = mode;

  // The single place appearance reaches the DOM.
  const applyEffective = useCallback(
    (
      registry: Theme[],
      stationId: string | null,
      override: string | null,
      modeOverride: ThemeMode | null,
    ) => {
      const resolved = resolveAppearance(registry, stationId, override, modeOverride);
      applyAppearance(resolved);
      cacheAppearance(resolved);
      setPaintedId(resolved.theme?.id ?? null);
    },
    [],
  );

  // Parameterless so the poll doesn't restart on every override change — the
  // overrides are read from refs inside the fetch.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const j = await defaultStationClient.themes();
        if (cancelled) return;
        setThemes(j.themes);
        setStationActiveId(j.active);
        applyEffective(j.themes, j.active, overrideRef.current, modeRef.current);
      } catch {
        // Network blip — keep the existing CSS variables; the next poll sorts
        // it out and the pre-paint cache covers the meantime.
      }
    };

    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [applyEffective]);

  // Applies without waiting for the next poll.
  const setOverride = useCallback(
    (id: string | null) => {
      saveThemeOverride(id);
      overrideRef.current = id;
      setOverrideIdState(id);
      applyEffective(themesRef.current, stationActiveId, id, modeRef.current);
    },
    [applyEffective, stationActiveId],
  );

  const setMode = useCallback(
    (next: ThemeMode | null) => {
      saveModeOverride(next);
      // Keep the ref in lock-step so the resolve below sees the new value on
      // this same tick (releasing must not re-apply the old mode).
      modeRef.current = next;
      setModeState(next);
      applyEffective(themesRef.current, stationActiveId, overrideRef.current, next);
    },
    [applyEffective, stationActiveId],
  );

  // Auto must stay reachable: flipping *back* releases the pin rather than
  // pinning the opposite mode. A two-state toggle would leave a stray `d`
  // detaching the listener from the operator's palette forever.
  const cycleMode = useCallback(() => {
    const auto = resolveAppearance(themesRef.current, stationActiveId, overrideRef.current, null);
    const autoMode = auto.mode ?? systemMode();
    const rendered = modeRef.current ?? autoMode;
    const next: ThemeMode = rendered === 'dark' ? 'light' : 'dark';
    setMode(autoMode === next ? null : next);
  }, [setMode, stationActiveId]);

  const cycleModeRef = useRef(cycleMode);
  cycleModeRef.current = cycleMode;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'd') return;
      if (isTypingTarget(e.target)) return;
      // A keypress aimed at a dialog shouldn't restyle the app behind it.
      if (e.target instanceof HTMLElement && e.target.closest('[role="dialog"]')) return;
      // Deliberately neither preventDefault nor act inline. Skin shortcut maps
      // and the tune-in gate share this keypress, and registration order is
      // mount-order dependent (skins are lazy chunks, so they can register
      // after this root-level provider). Deferring a task lets them run first;
      // if one claimed it, `defaultPrevented` is now true and we stand down.
      setTimeout(() => {
        if (e.defaultPrevented) return;
        cycleModeRef.current();
      }, 0);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Mirrors resolveAppearance's palette precedence so consumers don't
  // re-implement it.
  const effectiveId =
    (overrideId && themes.some(t => t.id === overrideId) ? overrideId : stationActiveId) ?? null;
  const renderedMode: ThemeMode =
    mode ?? themes.find(t => t.id === effectiveId)?.mode ?? (systemDark ? 'dark' : 'light');

  return (
    <ThemeContext.Provider
      value={{
        themes,
        stationActiveId,
        overrideId,
        effectiveId,
        paintedId,
        setOverride,
        mode,
        renderedMode,
        setMode,
        cycleMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
