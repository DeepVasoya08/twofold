import './switch.css';

interface SwitchProps {
  /** What it turns on and off, read out with its state ("Face grouping, on"). */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * An on/off setting. The track's position and colour show the state at a glance, with a
 * quiet "On" or "Off" beside it, so nobody has to work out whether a button names the
 * state or the action.
 */
export function Switch({ label, checked, onChange, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="switch__state" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </button>
  );
}
