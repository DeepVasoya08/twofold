import { Link } from '../app/router';
import { paths } from '../app/routes';
import { Fill, LegalPage } from '../components/LegalPage';
import { serviceFacts } from '../legal/details';

export function Terms() {
  return (
    <LegalPage
      title="Terms of Use"
      summary={
        <>
          <strong>The short version.</strong>
          <ul>
            <li>Your photos stay yours. We only store them, encrypted.</li>
            <li>
              Only you hold your keys. If you lose your password and your recovery key, we can’t get
              your photos back.
            </li>
            <li>Don’t use Twofold for anything illegal or to harm other people.</li>
            <li>Keep your own copies of anything you can’t afford to lose.</li>
          </ul>
        </>
      }
    >
      <h2>Agreeing to these terms</h2>
      <p>
        These terms are an agreement between you and{' '}
        <Fill field="operator" label="legal name of the operator" /> (“we”, “us”), which runs
        Twofold. By creating an account or using Twofold, you agree to them and to our{' '}
        <Link to={paths.privacy}>Privacy Policy</Link>. If you don’t agree, please don’t use
        Twofold.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>
          You must be at least <Fill field="minimumAge" label="minimum age" /> years old, or the
          minimum age where you live if that’s higher, to use Twofold.
        </li>
        <li>Give a real email address you control, and keep your passwords to yourself.</li>
        <li>You’re responsible for what happens in your account.</li>
      </ul>

      <h2>Your keys and your recovery key</h2>
      <p>
        Twofold is end-to-end encrypted: your passwords and keys never reach us, so we can’t reset a
        password or open your photos for you.
      </p>
      <ul>
        <li>
          When you sign up you get a <strong>recovery key</strong>. It is the only way back into
          your library if you forget your password. Keep it somewhere safe.
        </li>
        <li>
          A <strong>private space</strong> has no recovery key. If you forget its password, its
          contents are lost for good.
        </li>
        <li>
          If you lose access this way, we can’t help you recover your photos, and we aren’t
          responsible for that loss.
        </li>
      </ul>

      <h2>Storage</h2>
      <p>
        Each account can store up to {serviceFacts.storageLimit} of encrypted data, shared across
        its library and private space. We may change limits in the future, and will tell you before
        a change affects photos you’ve already stored.
      </p>

      <h2>Your content</h2>
      <p>
        You keep all rights to the photos and other content you put in Twofold. You give us only the
        permission we need to store your encrypted content, make copies of it to keep it safe, and
        deliver it to you and the people you share it with. Because it’s encrypted, we can’t see it,
        and we don’t use it for anything else.
      </p>
      <p>
        You’re responsible for having the right to store and share what you upload, including photos
        of other people.
      </p>

      <h2>Sharing</h2>
      <p>
        When you share a library or album, the people you invite can view and download those photos,
        and, if you allow it, add, edit and delete them. They can keep copies even after you stop
        sharing. You’re responsible for who you invite.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to use Twofold to:</p>
      <ul>
        <li>store or share anything illegal, including child sexual abuse material;</li>
        <li>
          share intimate images of anyone without their consent, or harass, threaten or exploit
          anyone;
        </li>
        <li>infringe anyone else’s copyright, privacy or other rights;</li>
        <li>
          interfere with the service, try to break its security, or access accounts or data that
          aren’t yours;
        </li>
        <li>use automated means to create accounts or overload the service.</li>
      </ul>
      <p>
        We can’t see your content, but we will act on credible reports and on valid legal requests,
        which can include suspending or closing accounts. Report abuse to{' '}
        <Fill field="contactEmail" label="contact email" />.
      </p>

      <h2>The service</h2>
      <p>
        We work hard to keep Twofold available and your data safe, but Twofold is provided “as is”
        and “as available”. Features may change, and the service may sometimes be interrupted. Keep
        your own copies of photos you can’t afford to lose; you can download your originals at any
        time.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using Twofold and delete your account in Settings at any time. We may suspend
        or close an account that breaks these terms or puts the service or others at risk. If we
        ever shut Twofold down, we’ll give reasonable notice so you can download your photos first.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we aren’t liable for indirect or consequential losses, or for
        loss of data caused by lost passwords or recovery keys. Nothing in these terms limits rights
        you have under consumer law that can’t be limited by agreement.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of <Fill field="jurisdiction" label="jurisdiction" />,
        and disputes will be handled by its courts, unless the law where you live gives you the
        right to bring a claim there.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If we change these terms, we’ll update the date at the top, and tell you in the app or by
        email before significant changes take effect. Continuing to use Twofold after that means you
        accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <Fill field="contactEmail" label="contact email" />.
      </p>
    </LegalPage>
  );
}
