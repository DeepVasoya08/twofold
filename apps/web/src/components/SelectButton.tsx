import type { Selection } from '../app/selection';
import { Icon } from './Icon';

/** Starts picking photos. Touch screens need it; with a mouse, each photo has its own check. */
export function SelectButton({ selection }: { selection: Selection }) {
  if (selection.selecting) return null;
  return (
    <button type="button" className="btn btn--secondary" onClick={selection.start}>
      <Icon name="check" size={18} />
      Select
    </button>
  );
}
