import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'timeflex.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

const readMode = (): ThemeMode => {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
};

const resolve = (mode: ThemeMode): ResolvedTheme => (mode === 'system' ? (media().matches ? 'dark' : 'light') : mode);

const apply = (theme: ResolvedTheme) => {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0f17' : '#f4f6fb');
};

/**
 * Theme state. The resolved theme is written to <html data-theme>, which the CSS
 * keys off; index.html sets it before first paint so there is no flash.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolve(readMode()));

  useEffect(() => {
    const update = () => {
      const next = resolve(mode);
      setTheme(next);
      apply(next);
    };
    update();
    const query = media();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [mode]);

  /** Switch theme with a circular reveal from the clicked point where the browser supports it. */
  const toggle = useCallback(
    (event?: { clientX: number; clientY: number }) => {
      const next: ResolvedTheme = theme === 'dark' ? 'light' : 'dark';
      const commit = () => {
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Not remembered, still applied.
        }
        apply(next);
        setTheme(next);
        setMode(next);
      };
      const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!doc.startViewTransition || reduced) {
        commit();
        return;
      }
      const x = event?.clientX ?? window.innerWidth - 40;
      const y = event?.clientY ?? 40;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const transition = doc.startViewTransition(commit);
      transition.ready
        .then(() =>
          document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
          ),
        )
        .catch(() => {});
    },
    [theme],
  );

  const useSystem = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing stored.
    }
    setMode('system');
  }, []);

  return { mode, theme, toggle, useSystem };
}
