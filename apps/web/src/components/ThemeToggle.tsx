import { useId } from 'react';
import type { ResolvedTheme } from '../theme';

interface ThemeToggleProps {
  theme: ResolvedTheme;
  onToggle: (event: { clientX: number; clientY: number }) => void;
  label?: boolean;
}

/** Sun / moon switch. The icon morphs: the moon's bite slides away and the rays grow in. */
export function ThemeToggle({ theme, onToggle, label = false }: ThemeToggleProps) {
  const dark = theme === 'dark';
  const mask = `bite-${useId().replace(/:/g, '')}`;
  return (
    <button
      type="button"
      className={`theme-toggle ${dark ? 'is-dark' : ''} ${label ? 'with-label' : ''}`}
      onClick={(event) => onToggle(event)}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <mask id={mask}>
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <circle className="bite" cx={dark ? 17 : 30} cy={dark ? 7 : 0} r="7" fill="black" />
        </mask>
        <circle className="core" cx="12" cy="12" r={dark ? 8 : 5} fill="currentColor" mask={`url(#${mask})`} />
        <g className="rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <line key={angle} x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${angle} 12 12)`} />
          ))}
        </g>
      </svg>
      {label && <span>{dark ? 'Dark' : 'Light'}</span>}
    </button>
  );
}
