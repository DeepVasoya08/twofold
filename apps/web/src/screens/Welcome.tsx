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
    text: 'Every photo is encrypted on your device. Our servers only ever hold scrambled data.',
  },
  {
    icon: 'users',
    title: 'Just the two of you',
    text: 'One shared vault, two keys. No followers, no feeds, no one else invited.',
  },
  {
    icon: 'heart',
    title: 'Made for keeping',
    text: 'Albums for trips and slow Sundays, favorites for the ones you return to.',
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
              A private place
              <br />
              for the two of you.
            </h1>
            <p className="welcome__lede">
              Twofold is a photo vault for couples. Your memories are sealed on your own devices, so
              they stay between you, and only you.
            </p>
            <div className="welcome__cta">
              <Link to={paths.signup} className="btn btn--primary btn--lg">
                Create your vault
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
              <Icon name="heart" size={16} filled /> Only us
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
        <span>End-to-end encrypted. Open about how.</span>
      </footer>
    </div>
  );
}
