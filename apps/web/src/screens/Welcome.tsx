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

/** The phone app's library in the hero: small tiles, so they stay light. */
const phonePhotos = [
  art(11, 'dusk', 200, 200),
  art(23, 'dawn', 200, 200),
  art(37, 'forest', 200, 200),
  art(41, 'sunset', 200, 200),
  art(53, 'ocean', 200, 200),
  art(61, 'golden', 200, 200),
  art(67, 'ocean', 200, 200),
  art(71, 'dawn', 200, 200),
  art(73, 'forest', 200, 200),
  art(79, 'sunset', 200, 200),
  art(83, 'desert', 200, 200),
  art(89, 'golden', 200, 200),
];

/** The big arch window beside the headline. */
const heroArch = art(113, 'sunset', 760, 1000);

const libraryPhotos = [
  art(61, 'golden'),
  art(67, 'ocean'),
  art(71, 'dawn'),
  art(73, 'forest'),
  art(79, 'sunset'),
  art(83, 'desert'),
];

const privatePhotos = [
  art(89, 'night'),
  art(97, 'dusk'),
  art(101, 'night'),
  art(103, 'night'),
  art(109, 'dusk'),
  art(127, 'night'),
];

const searchPhotos = [
  art(131, 'ocean', 240, 240),
  art(137, 'sunset', 240, 240),
  art(139, 'dawn', 240, 240),
  art(149, 'golden', 240, 240),
];

const albumCover = art(107, 'golden', 1200, 800);

/** The person the illustrations share with. */
const estrella: Person = { id: 'contact', name: 'Estrella', email: '' };

/** The people in the People card. */
const faces = ['You', 'Riya', 'Sam', 'Estrella', 'Dev', 'Mira'];

const files: { name: string; kind: string }[] = [
  { name: 'Passport', kind: 'IDs' },
  { name: 'Laptop receipt', kind: 'Receipts' },
  { name: 'Lease agreement', kind: 'Documents' },
];

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
          <span className="welcome__title-accent">Truly private.</span>
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

      <div className="hero-art" aria-hidden="true">
        <figure className="hero-art__arch">
          <img src={heroArch} alt="" />
          <span className="hero-art__sticker">
            <Icon name="lock" size={14} /> Only you
          </span>
        </figure>
        <div className="phone-frame">
          <div className="phone-frame__screen">
            <span className="phone-frame__top">
              <LogoMark size={16} />
              Library
            </span>
            <span className="phone-frame__search">
              <Icon name="search" size={11} />
              Search photos, places, people
            </span>
            <span className="phone-frame__month">November</span>
            <span className="phone-frame__grid">
              {phonePhotos.map((src) => (
                <img key={src} src={src} alt="" />
              ))}
            </span>
            <span className="phone-frame__tabs">
              <span className="phone-frame__tab phone-frame__tab--on">
                <Icon name="photos" size={11} />
              </span>
              <span className="phone-frame__tab">
                <Icon name="albums" size={11} />
              </span>
              <span className="phone-frame__tab">
                <Icon name="file" size={11} />
              </span>
              <span className="phone-frame__tab">
                <Icon name="person" size={11} />
              </span>
            </span>
          </div>
        </div>
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
        <span className="mock-unlock__arch" />
        <span className="mock-unlock__title">Welcome back</span>
        <span className="mock-field">
          <Icon name="key" size={16} />
          <span className="mock-field__dots">••••••••••</span>
          <span className="mock-field__caret" />
        </span>
        <span className="mock-button">Unlock</span>
      </div>

      <div className="spaces-art__spaces">
        <div className="mock-space">
          <span className="mock-space__which">Everyday password</span>
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
          <span className="mock-space__which">Second password</span>
          <span className="mock-space__label">
            <Icon name="lock" size={15} /> Private
          </span>
          <div className="mock-space__grid">
            {privatePhotos.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Search, People and Files: what's worked out on your own device. */
function DeviceCards() {
  return (
    <div className="device__cards">
      <article className="device-card">
        <div className="device-card__art" aria-hidden="true">
          <span className="mock-search">
            <Icon name="search" size={14} />
            me and Estrella last year
          </span>
          <span className="mock-search__chips">
            {['You', 'Estrella', 'Last year'].map((part) => (
              <span key={part}>{part}</span>
            ))}
          </span>
          <span className="mock-search__grid">
            {searchPhotos.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
          </span>
        </div>
        <h3 className="device-card__title">Smart search</h3>
        <p className="device-card__text">
          Type a person, a date or what’s in the photo. Save a search as an album that fills itself.
        </p>
      </article>
      <article className="device-card">
        <div className="device-card__art device-card__art--faces" aria-hidden="true">
          {faces.map((name, index) => (
            <span key={name} className="mock-face">
              <img
                src={art(151 + index * 6, index % 2 === 0 ? 'golden' : 'dawn', 120, 120)}
                alt=""
              />
              {name}
            </span>
          ))}
        </div>
        <h3 className="device-card__title">People</h3>
        <p className="device-card__text">
          Faces are grouped on your device. Name them, and tag Friends, Family or Work.
        </p>
      </article>
      <article className="device-card">
        <div className="device-card__art device-card__art--files" aria-hidden="true">
          {files.map((file) => (
            <span key={file.name} className="mock-file">
              <Icon name="file" size={18} />
              <span>
                <strong>{file.name}</strong>
                {file.kind}
              </span>
            </span>
          ))}
        </div>
        <h3 className="device-card__title">Files</h3>
        <p className="device-card__text">
          Keep documents, receipts and IDs encrypted next to your photos, sorted for you.
        </p>
      </article>
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

        <section id="private" className="night">
          <div className="story">
            <div className="story__copy">
              <span className="eyebrow">Private space</span>
              <h2 className="section-title">One unlock screen. Two separate spaces.</h2>
              <p className="section-lede">
                Your everyday password opens your library. Set up a second password, type it in the
                same box, and a separate private space opens instead, with its own photos and
                albums.
              </p>
              <Checks
                items={[
                  'Your library looks the same with or without a private space.',
                  'Each space has its own keys, so opening one never opens the other.',
                  'Move photos into the private space whenever you like.',
                ]}
              />
            </div>
            <SpacesIllustration />
          </div>
        </section>

        <section id="device" className="device" aria-labelledby="device-title">
          <div className="section-head">
            <span className="eyebrow">On your device</span>
            <h2 id="device-title" className="section-title">
              Find anything. Without anyone looking.
            </h2>
            <p className="section-lede">
              Search, faces and sorting are worked out on your own phone or computer, then saved
              encrypted. Our servers never see what’s in your photos.
            </p>
          </div>
          <DeviceCards />
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
          <div className="how__card">
            <div className="section-head">
              <span className="eyebrow">How it works</span>
              <h2 className="section-title">Encrypted before it leaves your device.</h2>
            </div>
            <ol className="how__steps">
              {steps.map((step, index) => (
                <li key={step.title} className="how__step">
                  <span className="how__top">
                    <span className="how__icon">
                      <Icon name={step.icon} size={22} />
                    </span>
                    <span className="how__number">{String(index + 1)}</span>
                  </span>
                  <h3 className="how__title">{step.title}</h3>
                  <p className="how__text">{step.text}</p>
                </li>
              ))}
            </ol>
            <div className="how__visible">
              <Icon name="eye" size={20} />
              <p>
                <strong>What we can see.</strong> To run your account we see your email address,
                your name, how much storage you use, and what kind of devices you’re signed in on
                (like “Chrome on Android”). Not your photos, their dates or places, or your album
                names. <Link to={paths.privacy}>Read the Privacy Policy</Link>
              </p>
            </div>
          </div>
        </section>

        <section className="features" aria-labelledby="features-title">
          <div className="section-head">
            <span className="eyebrow">Everyday</span>
            <h2 id="features-title" className="section-title">
              Everything a photo library should do.
            </h2>
          </div>
          <ul className="features__grid">
            {features.map((feature) => (
              <li key={feature.title} className="feature">
                <Icon name={feature.icon} size={22} />
                <span>
                  <h3 className="feature__title">{feature.title}</h3>
                  <p className="feature__text">{feature.text}</p>
                </span>
              </li>
            ))}
          </ul>
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
          <div className="closing__arch">
            <LogoMark size={52} />
            <h2 className="section-title">Start your private photo library.</h2>
            <p className="section-lede">
              Set up takes a minute. Your recovery key is the only thing to keep safe.
            </p>
            <Link to={paths.signup} className="btn btn--lg closing__button">
              Get started
              <Icon name="arrow-right" size={18} />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
