import { Link } from '../app/router';
import { paths } from '../app/routes';
import { Avatar, LockBadge, LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { SiteFooter, SiteHeader } from '../components/SiteChrome';
import { landscapeDataUri } from '../mock/art';
import type { Palette } from '../mock/art';
import type { Person } from '../mock/data';
import { faq } from '../site/faq';

import './welcome.css';

/** Placeholder art for the illustrations. Same seed, same picture, so prerendering matches. */
function art(seed: number, palette: Palette, width = 800, height = 800): string {
  return landscapeDataUri({ seed, palette, width, height });
}

const heroPhotos = [
  art(11, 'dusk', 600, 800),
  art(23, 'dawn', 800, 600),
  art(37, 'forest'),
  art(41, 'sunset', 800, 600),
  art(53, 'sunset', 600, 800),
];

const libraryPhotos = [
  art(61, 'golden'),
  art(67, 'ocean'),
  art(71, 'dawn'),
  art(73, 'forest'),
  art(79, 'sunset'),
  art(83, 'desert'),
];

const privatePhotos = [art(89, 'night'), art(97, 'dusk'), art(101, 'dawn'), art(103, 'night')];

const albumCover = art(107, 'golden', 1200, 800);

/** The person the illustrations share with. */
const estrella: Person = { id: 'contact', name: 'Estrella', email: '' };

const steps: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'lock',
    title: 'Encrypted on your device',
    text: 'When you add a photo, your browser encrypts it and a small preview with keys made from your password, before anything is uploaded.',
  },
  {
    icon: 'cloud',
    title: 'Stored sealed',
    text: 'We keep the encrypted files under random names. We can’t open them, and we can’t tell what’s in them.',
  },
  {
    icon: 'key',
    title: 'Opened only by you',
    text: 'Your devices decrypt photos in memory when you look at them, and never save them anywhere unencrypted.',
  },
];

const features: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'photos',
    title: 'A timeline of everything',
    text: 'Every photo in one place, sorted by month.',
  },
  {
    icon: 'albums',
    title: 'Albums',
    text: 'Group photos however you like, and share a single album.',
  },
  { icon: 'heart', title: 'Favorites', text: 'Keep the best ones a tap away.' },
  {
    icon: 'upload',
    title: 'Uploads that keep going',
    text: 'Add hundreds at once and keep browsing while they upload.',
  },
  {
    icon: 'download',
    title: 'Your originals, any time',
    text: 'Download full-quality originals, zipped on a computer.',
  },
  {
    icon: 'eye-off',
    title: 'Locks itself',
    text: 'Arcafold locks when you’ve been away for a while, so an open tab stays private.',
  },
  {
    icon: 'laptop',
    title: 'Every device in view',
    text: 'See where you’re signed in and sign out any device remotely.',
  },
  {
    icon: 'shield',
    title: 'A recovery key',
    text: 'No reset emails. A key only you hold gets you back in.',
  },
];

function Hero() {
  return (
    <section className="welcome__hero">
      <div className="welcome__copy">
        <LockBadge />
        <h1 className="welcome__title">
          Your photos.
          <br />
          Truly private.
        </h1>
        <p className="welcome__lede">
          Arcafold is a photo library that encrypts every photo on your device before it’s uploaded.
          No ads, no scanning, no one looking through your memories but you.
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
        {heroPhotos.map((src, index) => (
          <figure key={src} className={`welcome__card welcome__card--${String(index)}`}>
            <img src={src} alt="" />
          </figure>
        ))}
        <span className="welcome__sticker">
          <Icon name="lock" size={16} /> Only you
        </span>
        <span className="welcome__shared">
          <Avatar person={estrella} size="sm" />
          Shared with Estrella
        </span>
      </div>
    </section>
  );
}

function Checks({ items }: { items: string[] }) {
  return (
    <ul className="checks">
      {items.map((item) => (
        <li key={item}>
          <Icon name="check" size={18} />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** One password box, and the two spaces it can open. */
function SpacesIllustration() {
  return (
    <div
      className="spaces-art"
      role="img"
      aria-label="One unlock screen. The everyday password opens the library; a second password opens a separate private space."
    >
      <div className="mock-unlock">
        <LogoMark size={30} />
        <span className="mock-unlock__title">Welcome back</span>
        <span className="mock-field">
          <Icon name="key" size={16} />
          <span className="mock-field__dots">••••••••••</span>
          <span className="mock-field__caret" />
        </span>
        <span className="mock-button">Unlock</span>
      </div>

      <div className="spaces-art__paths">
        <span className="spaces-art__path">
          Everyday password <Icon name="arrow-right" size={14} />
        </span>
        <span className="spaces-art__path spaces-art__path--private">
          Second password <Icon name="arrow-right" size={14} />
        </span>
      </div>

      <div className="spaces-art__spaces">
        <div className="mock-space">
          <span className="mock-space__label">
            <Icon name="photos" size={15} /> Library
          </span>
          <div className="mock-space__grid">
            {libraryPhotos.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </div>
        </div>
        <div className="mock-space mock-space--private">
          <span className="mock-space__label">
            <Icon name="lock" size={15} /> Private
          </span>
          <div className="mock-space__grid mock-space__grid--two">
            {privatePhotos.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** An album shared with Estrella, and the check before access is sent. */
function SharingIllustration() {
  return (
    <div
      className="share-art"
      role="img"
      aria-label="The album Lisbon weekend, shared with Estrella, and the four words both people check before it's shared."
    >
      <div className="mock-album">
        <img className="mock-album__cover" src={albumCover} alt="" />
        <div className="mock-album__body">
          <span className="mock-album__title">Lisbon weekend</span>
          <span className="mock-album__meta">24 photos</span>
          <span className="mock-chip">
            <Avatar person={estrella} size="sm" />
            Shared with Estrella
          </span>
        </div>
      </div>

      <div className="mock-invite">
        <div className="mock-invite__head">
          <Avatar person={estrella} size="md" />
          <div>
            <span className="mock-invite__title">Estrella wants to join “Lisbon weekend”</span>
            <span className="mock-invite__sub">Check these 4 words with Estrella</span>
          </div>
        </div>
        <div className="mock-invite__words">
          {['amber', 'harbor', 'velvet', 'comet'].map((word) => (
            <span key={word}>{word}</span>
          ))}
        </div>
        <div className="mock-invite__foot">
          <span className="mock-pill">
            <Icon name="eye" size={14} /> View only
          </span>
          <span className="mock-button mock-button--small">They match, share</span>
        </div>
      </div>
    </div>
  );
}

export function Welcome() {
  return (
    <div className="welcome">
      <SiteHeader />

      <main>
        <Hero />

        <section id="private" className="story">
          <div className="story__copy">
            <span className="eyebrow">Private space</span>
            <h2 className="section-title">One unlock screen. Two separate spaces.</h2>
            <p className="section-lede">
              Your everyday password opens your library. Set up a second password, type it in the
              same box, and a separate private space opens instead, with its own photos and albums.
            </p>
            <Checks
              items={[
                'Your library never shows whether a private space exists.',
                'Each space has its own keys, so opening one never opens the other.',
                'Move photos into the private space whenever you like.',
              ]}
            />
          </div>
          <SpacesIllustration />
        </section>

        <section id="sharing" className="story story--flip">
          <div className="story__copy">
            <span className="eyebrow">Sharing</span>
            <h2 className="section-title">Share with the people you choose.</h2>
            <p className="section-lede">
              Invite someone to your whole library, or to just one album. Decide whether they can
              only view, or add and edit too. You can change that, or stop sharing, at any time.
            </p>
            <Checks
              items={[
                'Before anything is shared, you both check the same four words.',
                'Shared photos stay end-to-end encrypted.',
                'Your private space is shared separately, or not at all.',
              ]}
            />
          </div>
          <SharingIllustration />
        </section>

        <section id="how" className="how">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2 className="section-title">Encrypted before it leaves your device.</h2>
          </div>
          <ol className="how__steps">
            {steps.map((step, index) => (
              <li key={step.title} className="how__step">
                <span className="how__icon">
                  <Icon name={step.icon} size={22} />
                </span>
                <span className="how__number">{String(index + 1)}</span>
                <h3 className="how__title">{step.title}</h3>
                <p className="how__text">{step.text}</p>
              </li>
            ))}
          </ol>
          <div className="how__visible">
            <Icon name="eye" size={20} />
            <p>
              <strong>What we can see.</strong> To run your account we see your email address, your
              name, how much storage you use, and what kind of devices you’re signed in on (like
              “Chrome on Android”). Not your photos, their dates or places, or your album names.{' '}
              <Link to={paths.privacy}>Read the Privacy Policy</Link>
            </p>
          </div>
        </section>

        <section className="features" aria-labelledby="features-title">
          <div className="section-head">
            <span className="eyebrow">Everyday</span>
            <h2 id="features-title" className="section-title">
              Everything a photo library should do.
            </h2>
          </div>
          <div className="features__grid">
            {features.map((feature) => (
              <article key={feature.title} className="feature">
                <span className="feature__icon">
                  <Icon name={feature.icon} size={20} />
                </span>
                <h3 className="feature__title">{feature.title}</h3>
                <p className="feature__text">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="faq" className="faq" aria-labelledby="faq-title">
          <div className="section-head">
            <span className="eyebrow">Questions</span>
            <h2 id="faq-title" className="section-title">
              The honest answers.
            </h2>
          </div>
          <div className="faq__list">
            {faq.map((item) => (
              <details key={item.question} className="faq__item">
                <summary>
                  {item.question}
                  <Icon name="plus" size={18} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="closing">
          <LogoMark size={44} />
          <h2 className="section-title">Start your private photo library.</h2>
          <p className="section-lede">
            Set up takes a minute. Your recovery key is the only thing to keep safe.
          </p>
          <Link to={paths.signup} className="btn btn--primary btn--lg">
            Get started
            <Icon name="arrow-right" size={18} />
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
