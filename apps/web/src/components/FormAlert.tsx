/** A form-level error, announced to screen readers when it appears. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-alert" role="alert">
      {message}
    </p>
  );
}
