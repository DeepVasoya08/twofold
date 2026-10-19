import { useSelection } from '../app/selection';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { PhotoGrid } from '../components/PhotoGrid';
import { SelectButton } from '../components/SelectButton';
import { SelectionBar } from '../components/SelectionBar';
import { pluralize, sortNewestFirst } from '../lib/format';

export function Favorites() {
  const { state } = useVault();
  const favorites = sortNewestFirst(state.photos.filter((photo) => photo.favorite));
  const selection = useSelection();

  return (
    <div className="page">
      <PageHeader
        title="Favorites"
        subtitle={
          favorites.length > 0
            ? `${pluralize(favorites.length, 'photo')} you keep coming back to`
            : undefined
        }
        actions={favorites.length > 0 && <SelectButton selection={selection} />}
      />
      <SelectionBar selection={selection} allIds={favorites.map((photo) => photo.id)} />
      {favorites.length === 0 ? (
        <EmptyState icon="heart" title="No favorites yet">
          Tap the heart on any photo to keep it here.
        </EmptyState>
      ) : (
        <PhotoGrid photos={favorites} context={{ kind: 'favorites' }} selection={selection} />
      )}
    </div>
  );
}
