import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { storage } from './storage';

export type ThemeName = 'light' | 'dark';

const light = {
  name: 'light' as ThemeName,
  bg: '#F4F6FB',
  bgDeep: '#E9ECF6',
  surface: '#FFFFFF',
  surface2: '#F1F3F8',
  surface3: '#E6E9F2',
  glass: 'rgba(255,255,255,0.72)',
  glassStrong: 'rgba(255,255,255,0.88)',
  glassBorder: 'rgba(255,255,255,0.9)',
  edge: 'rgba(30,41,80,0.08)',
  border: '#E1E5EE',
  borderStrong: '#CDD3DF',
  text: '#0F1424',
  text2: '#475069',
  muted: '#6B7489',
  accent: '#5B5BF0',
  accent2: '#A855F7',
  accent3: '#EC4899',
  accentSoft: '#ECEDFF',
  accentText: '#3730A3',
  onAccent: '#FFFFFF',
  lab: '#9333EA',
  labSoft: '#F4EBFF',
  ok: '#059669',
  okSoft: '#E4F6EE',
  warn: '#B45309',
  warnSoft: '#FFF4E0',
  danger: '#DC2626',
  dangerSoft: '#FDEAEA',
  blob: ['#A5B4FC', '#F0ABFC', '#7DD3FC'],
  blobOpacity: 0.55,
  shadow: '#1E295A',
};

const dark: typeof light = {
  name: 'dark',
  bg: '#0A0D16',
  bgDeep: '#06080F',
  surface: '#141A28',
  surface2: '#1A2132',
  surface3: '#242D42',
  glass: 'rgba(20,26,40,0.66)',
  glassStrong: 'rgba(24,30,46,0.86)',
  glassBorder: 'rgba(255,255,255,0.08)',
  edge: 'rgba(0,0,0,0.3)',
  border: '#283147',
  borderStrong: '#37425C',
  text: '#E9ECF4',
  text2: '#B3BBCD',
  muted: '#8790A6',
  accent: '#8B8CFF',
  accent2: '#C084FC',
  accent3: '#F472B6',
  accentSoft: 'rgba(139,140,255,0.16)',
  accentText: '#C9CAFF',
  onAccent: '#0A0D16',
  lab: '#C084FC',
  labSoft: 'rgba(192,132,252,0.15)',
  ok: '#34D399',
  okSoft: 'rgba(52,211,153,0.13)',
  warn: '#FBBF24',
  warnSoft: 'rgba(251,191,36,0.12)',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.13)',
  blob: ['#4F46E5', '#9333EA', '#0891B2'],
  blobOpacity: 0.35,
  shadow: '#000000',
};

export type Palette = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

type Choice = ThemeName | 'system';

const ThemeContext = createContext<{ c: Palette; choice: Choice; setChoice: (choice: Choice) => void; toggle: () => void }>({
  c: light,
  choice: 'system',
  setChoice: () => {},
  toggle: () => {},
});

const KEY = 'timeflex.theme';

/** Follows the device's light/dark setting until the user picks one, which is remembered. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<Choice>('system');

  useEffect(() => {
    storage.get(KEY).then((value) => {
      if (value === 'light' || value === 'dark') setChoiceState(value);
    });
  }, []);

  const resolved: ThemeName = choice === 'system' ? (system === 'dark' ? 'dark' : 'light') : choice;
  const value = useMemo(() => {
    const setChoice = (next: Choice) => {
      setChoiceState(next);
      storage.set(KEY, next === 'system' ? null : next);
    };
    return { c: resolved === 'dark' ? dark : light, choice, setChoice, toggle: () => setChoice(resolved === 'dark' ? 'light' : 'dark') };
  }, [resolved, choice]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
