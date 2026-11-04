import { useAccount } from '../session/account';
import { Button, Note, Screen } from '../ui/kit';

/** The unlocked app, until the timeline arrives in the next step. */
export function Home() {
  const { state, space, lock, logOut } = useAccount();
  if (state.status !== 'unlocked') return null;
  return (
    <Screen
      title={space === 'private' ? 'Private space' : 'Your library'}
      subtitle="Arcafold is open. Your photos will show here in the next build."
    >
      <Note>
        It locks when you leave the app, or after a minute without a touch. Screenshots are blocked.
      </Note>
      <Button label="Lock now" onPress={lock} />
      <Button
        kind="link"
        label="Sign out"
        onPress={() => {
          void logOut();
        }}
      />
    </Screen>
  );
}
