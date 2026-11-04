import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { usePeople } from '../app/people';
import { useSearch } from '../app/search';
import { useToast } from '../app/toast';
import { MAX_EXAMPLES, MAX_WORD_NAME, MIN_EXAMPLES, wordNameProblem } from '../lib/search/taught';
import { Dialog } from './Dialog';
import { TextField } from './Field';
import { errorMessage } from '@arcafold/core/errors';

/**
 * Teaches search a word from the selected photos: "Biscuit" for a dog, "the cabin" for a
 * place. The name and photos are sealed like everything else; after that, typing the name
 * finds photos that look like these.
 */
export function TeachWordDialog({
  open,
  photoIds,
  onClose,
  onTaught,
}: {
  open: boolean;
  photoIds: readonly string[];
  onClose: () => void;
  onTaught: () => void;
}) {
  const search = useSearch();
  const { people } = usePeople();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fits = photoIds.length >= MIN_EXAMPLES && photoIds.length <= MAX_EXAMPLES;

  const close = () => {
    setName('');
    setError(null);
    onClose();
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = wordNameProblem(name, {
      people: people.map((person) => person.name),
      words: search.words.map((word) => word.name),
    });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    search
      .teach(name, photoIds)
      .then((word) => {
        toast.show(`Search learned “${word.name}”`);
        setName('');
        onTaught();
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Teach search a word"
      description={
        fits
          ? 'Name what these photos show, like a pet’s name or a favorite place. Then search for it by name.'
          : `Choose ${String(MIN_EXAMPLES)} to ${String(MAX_EXAMPLES)} photos that show the same thing, like a pet or a place.`
      }
    >
      {fits ? (
        <form className="form" onSubmit={onSubmit} noValidate>
          <TextField
            label="Word"
            autoFocus
            value={name}
            maxLength={MAX_WORD_NAME}
            autoComplete="off"
            onChange={(event) => {
              setName(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              Teach
            </button>
          </div>
        </form>
      ) : (
        <div className="dialog__actions">
          <button type="button" className="btn btn--primary" onClick={close}>
            OK
          </button>
        </div>
      )}
    </Dialog>
  );
}
