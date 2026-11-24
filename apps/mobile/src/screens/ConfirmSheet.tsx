import { useState } from 'react';

import { errorMessage } from '@arcafold/core/errors';

import { Banner, Button } from '../ui/kit';
import { Sheet } from '../ui/sheet';

/**
 * Asks before deleting something: a title, what it means, and one red button that does it.
 * Stays open while it runs, and shows why if it fails.
 */
export function ConfirmSheet({
  title,
  body,
  action,
  busyLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  action: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onConfirm().then(
      () => {
        setBusy(false);
      },
      (caught: unknown) => {
        setBusy(false);
        setError(errorMessage(caught));
      },
    );
  };
  return (
    <Sheet title={title} body={body} busy={busy} onCancel={onCancel}>
      {error ? <Banner>{error}</Banner> : null}
      <Button kind="danger" label={action} busyLabel={busyLabel} busy={busy} onPress={submit} />
      <Button kind="link" label="Cancel" onPress={busy ? () => undefined : onCancel} />
    </Sheet>
  );
}
