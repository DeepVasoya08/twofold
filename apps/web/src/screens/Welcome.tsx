import { Link } from '../app/router';
import { paths } from '../app/routes';
import { Logo, LockBadge } from '../components/Brand';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { initialPhotos } from '../mock/data';

import './welcome.css';

const heroPhotos = ['p009', 'p002', 'p022', 'p014', 'p027']
  .map((id) => initialPhotos.find((photo) => photo.id === id))
  .filter((photo) => photo !== undefined);

const features: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'lock',
    title: 'Locked before it leaves',
    text: 'Every photo is encrypted on your device. Our servers only ever hold data they can’t read.',
  },
  {
    icon: 'eye-off',
    title: 'A space no one knows about',
    text: 'Add a second password and a separate private space opens with it. Your everyday password never reveals it.',
  },
  {
    icon: 'users',
    title: 'Shared on your terms',
    text: 'Invite someone you trust to a library. Nothing is shared unless you choose to share it.',
  },
];

export function Welcome() {
  return (
    <div className="welcome">
      <header className="welcome__nav">
        <Logo />
        <Link to={paths.login} className="btn btn--ghost btn--sm">
          Log in
        </Link>
      </header>

      <main>
        <section className="welcome__hero">
          <div className="welcome__copy">
            <LockBadge />
            <h1 className="welcome__title">
              Your photos.
              <br />
              Truly private.
            </h1>
            <p className="welcome__lede">
              Twofold backs up your photo library with end-to-end encryption. No ads, no scanning,
              no one looking through your memories but you.
            </p>
            <div className="welcome__cta">
              <Link to={paths.signup} className="btn btn--primary btn--lg">
                Get started
                <Icon name="arrow-right" size={18} />
              </Link>
              <Link to={paths.login} className="btn btn--secondary btn--lg">
                I have an account
              </Link>
            </div>
          </div>

          <div className="welcome__stack" aria-hidden="true">
            {heroPhotos.map((photo, index) => (
              <figure key={photo.id} className={`welcome__card welcome__card--${String(index)}`}>
                <img src={photo.src} alt="" />
              </figure>
            ))}
            <span className="welcome__sticker">
              <Icon name="lock" size={16} /> Only you
            </span>
          </div>
        </section>

        <section className="welcome__features" aria-label="Why Twofold">
          {features.map((feature) => (
            <article key={feature.title} className="feature">
              <span className="feature__icon">
                <Icon name={feature.icon} size={22} />
              </span>
              <h2 className="feature__title">{feature.title}</h2>
              <p className="feature__text">{feature.text}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="welcome__footer">
        <span>Twofold</span>
        <span>End-to-end encrypted. No ads, ever.</span>
      </footer>
    </div>
  );
}
