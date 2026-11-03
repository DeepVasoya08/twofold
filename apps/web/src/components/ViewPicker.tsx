import { usePhotoView } from '../app/views';
import { Icon } from './Icon';
import type { IconName } from './Icon';

import './view-picker.css';

export interface ViewChoice<V extends string> {
  id: V;
  label: string;
  icon: IconName;
}

/** A row of icon buttons choosing how a screen is laid out. */
export function ViewPicker<V extends string>({
  choices,
  value,
  onChange,
}: {
  choices: readonly ViewChoice<V>[];
  value: V;
  onChange: (view: V) => void;
}) {
  return (
    <div className="view-picker" role="group" aria-label="View">
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          className="view-picker__option"
          aria-pressed={value === choice.id}
          aria-label={choice.label}
          title={choice.label}
          onClick={() => {
            onChange(choice.id);
          }}
        >
          <Icon name={choice.icon} size={18} />
        </button>
      ))}
    </div>
  );
}

export const PHOTO_VIEW_CHOICES = [
  { id: 'grid', label: 'Grid', icon: 'grid' },
  { id: 'compact', label: 'Compact grid', icon: 'grid-small' },
  { id: 'uncropped', label: 'Uncropped', icon: 'rows' },
] as const satisfies readonly ViewChoice<string>[];

export const FILE_VIEW_CHOICES = [
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'grid', label: 'Grid', icon: 'grid' },
] as const satisfies readonly ViewChoice<string>[];

/** The View buttons for screens of photos; every photo grid follows the choice. */
export function PhotoViewPicker() {
  const [view, setView] = usePhotoView();
  return <ViewPicker choices={PHOTO_VIEW_CHOICES} value={view} onChange={setView} />;
}
