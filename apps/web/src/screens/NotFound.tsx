import { Link } from '../app/router';
import { paths } from '../app/routes';
import { Logo } from '../components/Brand';

import './not-found.css';

export function NotFound() {
  return (
    <main className="not-found">
      <Logo />
      <p className="not-found__code" aria-hidden="true">
        404
      </p>
      <h1 className="not-found__title">This page wandered off</h1>
      <p className="not-found__text">The link may be old, or the page may have moved.</p>
      <div className="not-found__actions">
        <Link to={paths.gallery} className="btn btn--primary">
          Go to our photos
        </Link>
        <Link to={paths.welcome} className="btn btn--ghost">
          Home
        </Link>
      </div>
    </main>
  );
}
