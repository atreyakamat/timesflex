interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** Shown after the number, e.g. "min" or "students". */
  unit?: string;
}

/** A − value + control: easier than a number box on phones, and it cannot hold junk. */
export function Stepper({ value, onChange, min = 0, max = 999, step = 1, label, unit }: StepperProps) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <div className="stepper" role="group" aria-label={label}>
      {label && <span className="stepper-label">{label}</span>}
      <div className="stepper-control">
        <button type="button" onClick={() => set(value - step)} disabled={value <= min} aria-label={`Decrease ${label ?? ''}`}>
          −
        </button>
        <span className="stepper-value" aria-live="polite">
          {value}
          {unit && <small> {unit}</small>}
        </span>
        <button type="button" onClick={() => set(value + step)} disabled={value >= max} aria-label={`Increase ${label ?? ''}`}>
          +
        </button>
      </div>
    </div>
  );
}
