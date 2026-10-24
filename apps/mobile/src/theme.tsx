import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { storage } from './storage';

export type ThemeName = 'light' | 'dark';

// Restrained, Luma-like palettes: near-neutral surfaces, soft grey text, one quiet accent,
// and a faint glow behind everything. Colour is kept for meaning (labs, warnings, success).
const light = {
  name: 'light' as ThemeName,
  bg: '#F6F6F7',
  bgDeep: '#EDEDEF',
  surface: '#FFFFFF',
  surface2: '#F4F4F5',
  surface3: '#EBEBED',
  glass: 'rgba(255,255,255,0.78)',
  glassStrong: 'rgba(255,255,255,0.92)',
  glassBorder: 'rgba(17,17,19,0.07)',
  edge: 'rgba(17,17,19,0.05)',
  border: '#E4E4E7',
  borderStrong: '#D4D4D8',
  text: '#111113',
  text2: '#52525B',
  muted: '#71717A',
  accent: '#5B5BD6',
  accent2: '#8E7CC3',
  accent3: '#C27A9E',
  accentSoft: 'rgba(91,91,214,0.08)',
  accentText: '#3E3EA8',
  onAccent: '#FFFFFF',
  primary: '#111113',
  onPrimary: '#FFFFFF',
  gradient: ['#1C1C1F', '#2E2E33'] as [string, string],
  lab: '#7C5CBF',
  labSoft: 'rgba(124,92,191,0.08)',
  ok: '#16A34A',
  okSoft: 'rgba(22,163,74,0.08)',
  warn: '#B45309',
  warnSoft: 'rgba(180,83,9,0.08)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220,38,38,0.07)',
  blob: ['#C7C9F5', '#F3DDC8', '#D6E4F0'],
  blobOpacity: 0.45,
  tile: { sat: 32, light: 52, alpha: 0.09, edgeSat: 30, edgeLight: 46 },
  shadow: '#000000',
};

const dark: typeof light = {
  name: 'dark',
  bg: '#0B0B0D',
  bgDeep: '#070708',
  surface: '#141416',
  surface2: '#19191C',
  surface3: '#222226',
  glass: 'rgba(24,24,27,0.66)',
  glassStrong: 'rgba(28,28,32,0.88)',
  glassBorder: 'rgba(255,255,255,0.07)',
  edge: 'rgba(0,0,0,0.4)',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  text: '#F4F4F5',
  text2: '#B4B4BB',
  muted: '#7C7C86',
  accent: '#A8B1FF',
  accent2: '#C4B5FD',
  accent3: '#F0ABFC',
  accentSoft: 'rgba(168,177,255,0.09)',
  accentText: '#C9CEFF',
  onAccent: '#0B0B0D',
  primary: '#F4F4F5',
  onPrimary: '#0B0B0D',
  gradient: ['#26262B', '#1A1A1E'] as [string, string],
  lab: '#B9A3F0',
  labSoft: 'rgba(185,163,240,0.09)',
  ok: '#6EE7A8',
  okSoft: 'rgba(110,231,168,0.08)',
  warn: '#F5C870',
  warnSoft: 'rgba(245,200,112,0.08)',
  danger: '#F59393',
  dangerSoft: 'rgba(245,147,147,0.08)',
  blob: ['#4C3A8C', '#6B4A2E', '#1F3654'],
  blobOpacity: 0.22,
  tile: { sat: 28, light: 62, alpha: 0.1, edgeSat: 30, edgeLight: 64 },
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

/** Dark by default (the calmer look); light and automatic are choices, remembered. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [choice, setChoiceState] = useState<Choice>('dark');

  useEffect(() => {
    storage.get(KEY).then((value) => {
      if (value === 'light' || value === 'dark' || value === 'system') setChoiceState(value);
    });
  }, []);

  const resolved: ThemeName = choice === 'system' ? (system === 'dark' ? 'dark' : 'light') : choice;
  const value = useMemo(() => {
    const setChoice = (next: Choice) => {
      setChoiceState(next);
      storage.set(KEY, next);
    };
    return { c: resolved === 'dark' ? dark : light, choice, setChoice, toggle: () => setChoice(resolved === 'dark' ? 'light' : 'dark') };
  }, [resolved, choice]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
