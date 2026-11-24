import { useState } from 'react';

import { usePhotoView } from '../app/views';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import type { IconName } from './Icon';

import './view-picker.css';

/** A little drawing of a layout: rows of shapes, each number a shape's relative width. */
export interface ViewDrawing {
  shape: 'square' | 'line';
  rows: readonly (readonly number[])[];
}

export interface ViewChoice<V extends string> {
  id: V;
  label: string;
  icon: IconName;
  /** A few words on what it looks like, under its name in the phone-width View sheet. */
  detail: string;
  drawing: ViewDrawing;
}

/** A tiny picture of a layout, so each choice shows what it looks like, not just its name. */
function Drawing({ drawing }: { drawing: ViewDrawing }) {
  return (
    <span className={`view-drawing view-drawing--${drawing.shape}`} aria-hidden="true">
      {drawing.rows.map((row, rowIndex) => (
        <span key={rowIndex} className="view-drawing__row">
          {row.map((grow, index) =>
            drawing.shape === 'line' ? (
              <span key={index} className="view-drawing__line">
                <span className="view-drawing__tile" />
                <span className="view-drawing__text" />
              </span>
            ) : (
              <span key={index} className="view-drawing__cell" style={{ flexGrow: grow }} />
            ),
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * How a screen is laid out. On wider screens, a row of icon buttons; at phone widths, one
 * View button that opens a sheet of cards, each with a little picture of its layout (the same
 * as the phone app). Picking a card closes the sheet.
 */
export function ViewPicker<V extends string>({
  choices,
  value,
  onChange,
}: {
  choices: readonly ViewChoice<V>[];
  value: V;
  onChange: (view: V) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = choices.find((choice) => choice.id === value) ?? choices[0];
  return (
    <>
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
      <button
        type="button"
        className="view-picker__open"
        aria-label={`View: ${current?.label ?? ''}`}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name={current?.icon ?? 'grid'} size={18} />
      </button>
      <Dialog
        open={open}
        title="View"
        onClose={() => {
          setOpen(false);
        }}
      >
        <div className="view-cards" role="radiogroup" aria-label="View">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={value === choice.id}
              className="view-card"
              onClick={() => {
                onChange(choice.id);
                setOpen(false);
              }}
            >
              <Drawing drawing={choice.drawing} />
              <span className="view-card__label">{choice.label}</span>
              <span className="view-card__detail">{choice.detail}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </>
  );
}

const even = (across: number, rows: number) =>
  Array.from({ length: rows }, () => Array.from({ length: across }, () => 1));

export const PHOTO_VIEW_CHOICES = [
  {
    id: 'grid',
    label: 'Grid',
    icon: 'grid',
    detail: 'Squares',
    drawing: { shape: 'square', rows: even(4, 3) },
  },
  {
    id: 'compact',
    label: 'Compact grid',
    icon: 'grid-small',
    detail: 'Smaller, more across',
    drawing: { shape: 'square', rows: even(6, 4) },
  },
  {
    id: 'uncropped',
    label: 'Uncropped',
    icon: 'rows',
    detail: 'Each in its own shape',
    drawing: {
      shape: 'square',
      rows: [
        [1.5, 0.75, 1],
        [0.75, 1.5],
        [1, 1, 1.5],
      ],
    },
  },
] as const satisfies readonly ViewChoice<string>[];

export const FILE_VIEW_CHOICES = [
  {
    id: 'list',
    label: 'List',
    icon: 'list',
    detail: 'Names and details',
    drawing: { shape: 'line', rows: even(1, 4) },
  },
  {
    id: 'grid',
    label: 'Grid',
    icon: 'grid',
    detail: 'Previews',
    drawing: { shape: 'square', rows: even(3, 2) },
  },
] as const satisfies readonly ViewChoice<string>[];

/** The View buttons for screens of photos; every photo grid follows the choice. */
export function PhotoViewPicker() {
  const [view, setView] = usePhotoView();
  return <ViewPicker choices={PHOTO_VIEW_CHOICES} value={view} onChange={setView} />;
}
