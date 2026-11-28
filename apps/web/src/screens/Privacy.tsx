import { Link } from '../app/router';
import { paths } from '../app/routes';
import { Fill, LegalPage } from '../components/LegalPage';
import { serviceFacts } from '../legal/details';

export function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      uses={['operator', 'contactEmail']}
      summary={
        <>
          <strong>The short version.</strong>
          <ul>
            <li>
              Your photos, previews, albums and photo details are encrypted on your device. We store
              them, but we can’t read them.
            </li>
            <li>
              To run your account we keep your email address, your name, how much storage you use,
              and a short list of your signed-in devices.
            </li>
            <li>No ads, no trackers, no selling data, and no scanning of your photos.</li>
            <li>
              Importing from Google Photos reads only the photos you pick, straight to your device.
              We never receive your Google data.
            </li>
            <li>You can delete your account from Settings at any time.</li>
          </ul>
        </>
      }
    >
      <h2>Who we are</h2>
      <p>
        Arcafold is run by <Fill field="operator" label="legal name of the operator" /> (“we”,
        “us”). This policy explains what information Arcafold handles when you use the website and
        app, and what we do with it. If anything here is unclear, write to{' '}
        <Fill field="contactEmail" label="contact email" />.
      </p>

      <h2>What we can’t see</h2>
      <p>
        Arcafold is end-to-end encrypted. Your password is turned into encryption keys on your
        device, and your password itself is never sent to us. The following are encrypted on your
        device before they are uploaded, and we have no way to decrypt them:
      </p>
      <ul>
        <li>your photos and their previews;</li>
        <li>
          photo details such as when and where a photo was taken, favorites, and which albums a
          photo is in;
        </li>
        <li>album names, your profile photo, and the records of who you share with;</li>
        <li>whether you have a private space, and anything in it.</li>
      </ul>
      <p>
        Because we can’t read this content, we can’t search it, scan it, recover it for you, or hand
        it over in readable form to anyone.
      </p>

      <h2>What we collect and keep</h2>
      <h3>Your account</h3>
      <ul>
        <li>
          <strong>Email address and name</strong>, which you give us when you sign up. Your name is
          shown to people you share with.
        </li>
        <li>
          <strong>Your encrypted keyring</strong>: values derived from your passwords and recovery
          key that let your devices check a password and unlock your keys. They don’t reveal your
          passwords or keys.
        </li>
        <li>
          <strong>Storage used</strong>: the total size of the encrypted files you’ve stored, to
          enforce the {serviceFacts.storageLimit} limit.
        </li>
      </ul>
      <h3>Your devices</h3>
      <p>
        For each signed-in device we keep a random session id, a general device description made
        from your browser’s user agent (like “Chrome on Android”, with no version or model), and
        when it was last used, rounded to the hour. You can see this list in Settings and sign any
        device out. Sessions expire after 30 days.
      </p>
      <h3>Your encrypted files</h3>
      <p>
        We store the encrypted photos and previews you upload, under random names, along with their
        sizes and when they were uploaded.
      </p>
      <h3>Face grouping</h3>
      <p>
        If you turn on face grouping, your device finds the faces in your photos and groups photos
        of the same person. This happens only on your device. What it finds, including the face
        data, is encrypted there before it’s stored, so we can’t read it. We keep only your answer
        to whether face grouping should start on, and the day you gave it. You can turn it off on
        any device in Settings, and delete all face data for a space there.
      </p>
      <h3>Smart search</h3>
      <p>
        Smart search lets you find photos by describing them. Your device works out what each photo
        shows, and that is encrypted there before it’s stored, so we can’t read it. It uses no face
        data. What you search for is read on your device too: it’s never sent to us or saved. It’s
        on unless you turn it off on a device in Settings, where you can also delete all search data
        for a space.
      </p>
      <h3>Security</h3>
      <p>
        To stop people guessing passwords, we count failed sign-in attempts for each email address
        together with a one-way hash of the internet (IP) address they came from. These counts are
        deleted after 15 minutes.
      </p>
      <h3>Invites</h3>
      <p>
        When you invite someone, we hold the encrypted invite until it’s accepted or cancelled, or
        for up to {String(serviceFacts.inviteExpiryDays)} days.
      </p>

      <h2 id="google-user-data">Google user data</h2>
      <p>
        This section covers the information Arcafold gets from Google when you choose{' '}
        <strong>Connect Google Photos</strong> to import photos. You sign in to Google, Google asks
        whether Arcafold may see the photos you pick, and you then pick photos in Google Photos.
      </p>
      <h3>Data accessed</h3>
      <p>
        Arcafold asks for one permission (OAuth scope) only,{' '}
        <code>photospicker.mediaitems.readonly</code>: to view the photos and videos you select in
        Google Photos, through the Google Photos Picker API. With it, Arcafold reads only the items
        you pick: each photo’s file, file name, file type and the date it was taken. It can’t see
        anything you don’t pick, and it can’t change or delete anything in your Google account. We
        don’t ask for your Google email address, profile, contacts or any other Google data.
      </p>
      <h3>Data usage</h3>
      <p>
        The photos you pick are used for one purpose: copying them into your Arcafold library or
        private space, because you asked to. Arcafold doesn’t use Google user data for ads, doesn’t
        sell it, doesn’t use it to build profiles, and doesn’t use it to train AI or machine
        learning models.
      </p>
      <h3>Data sharing</h3>
      <p>
        We don’t share, sell or transfer Google user data to anyone. Your device downloads each
        picked photo straight from Google; it never passes through our servers unencrypted, and no
        other service receives it. People can see an imported photo only if you share it with them
        in Arcafold, like any other photo.
      </p>
      <h3>Data storage and protection</h3>
      <p>
        Each imported photo is encrypted on your device before it’s uploaded, so we store it but
        can’t read it, the same as photos you upload yourself. Google’s sign-in (access) token is
        kept only in your device’s memory while the import runs. It is never sent to our servers or
        written to your browser’s storage by Arcafold. Google hands it over in a page address, which
        your browser may keep in its history, so Arcafold revokes it at Google as soon as the import
        ends, is cancelled or Arcafold locks.
      </p>
      <h3>Data retention and deletion</h3>
      <p>
        We keep no Google user data apart from the photos you chose to import, which stay in your
        account until you delete them (deleted photos are removed as described under “How long we
        keep information” below). The picking session with Google is ended as soon as the import
        finishes. You can remove Arcafold’s access to your Google account at any time at{' '}
        <a href="https://myaccount.google.com/connections" rel="noreferrer noopener">
          myaccount.google.com/connections
        </a>
        , and ask us to delete your data at <Fill field="contactEmail" label="contact email" />.
      </p>
      <h3>Limited Use</h3>
      <p>
        Arcafold’s use and transfer to any other app of information received from Google APIs will
        adhere to the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          rel="noreferrer noopener"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>What we don’t do</h2>
      <ul>
        <li>We don’t show ads, and we don’t sell or rent your information.</li>
        <li>We don’t use analytics or tracking services, or third-party cookies.</li>
        <li>
          We don’t scan, analyze or train anything on your photos, including photos imported from
          Google Photos. Face grouping, if you turn it on, and Smart search run only on your device.
        </li>
        <li>
          We don’t keep per-request access logs of your use of the app. Our hosting provider still
          processes your IP address to deliver the service, as described below.
        </li>
      </ul>

      <h2>Cookies and storage in your browser</h2>
      <p>
        Arcafold uses one essential cookie to keep you signed in. It is only sent to Arcafold and
        can’t be read by scripts. Your browser also remembers a few preferences, such as when
        Arcafold should lock itself. Decrypted photos and keys are kept in memory only and are never
        saved in your browser’s storage.
      </p>

      <h2>How we use information</h2>
      <p>We use the information above only to:</p>
      <ul>
        <li>create and secure your account, and keep you signed in;</li>
        <li>store and deliver your encrypted files, and enforce storage limits;</li>
        <li>copy in the photos you pick from Google Photos, if you choose to;</li>
        <li>let you share with people you invite;</li>
        <li>prevent abuse, such as password guessing;</li>
        <li>contact you about your account or important changes to the service.</li>
      </ul>
      <p>
        Where the law requires a legal basis, we rely on performing our contract with you (running
        the service you signed up for) and our legitimate interest in keeping it secure.
      </p>

      <h2>Who processes your information</h2>
      <p>
        Arcafold runs on <strong>Cloudflare</strong>, which hosts the app, its database and the
        encrypted file storage. The database and encrypted files are currently stored in{' '}
        {serviceFacts.dataRegion}. Cloudflare processes your IP address and request details to
        deliver and protect the service, under its own privacy policy. We don’t use any other
        service providers to handle your data. If you import from Google Photos, your device talks
        to Google directly, under Google’s own privacy policy; that data doesn’t pass through us.
      </p>
      <p>
        We will only disclose information if the law requires it. What we can disclose is limited to
        what this policy says we keep; we can’t provide your photos in readable form.
      </p>

      <h2>Sharing with other people</h2>
      <p>
        When you share your library or an album, the people you invite get the keys they need to see
        those photos. They can download copies, and if you stop sharing, we can’t remove copies they
        already saved. Only share with people you trust.
      </p>

      <h2>How long we keep information, and deleting it</h2>
      <p>
        We keep your account information for as long as you have an account. You can delete your
        account in Settings. That deletes your account, its sessions, and the photos in every space
        your device has the keys for when you delete it. Encrypted data we can’t link to you any
        more (for example, a private space whose password wasn’t entered) can’t be decrypted by
        anyone, and may stay in storage. Deleted data can also remain for up to 30 days in our
        backups and our provider’s, which hold the same encrypted data and are themselves encrypted.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, export or delete
        your personal information, and to object to or restrict how we use it. You can change your
        name and delete your account yourself in Settings, and download your photos at any time. For
        anything else, write to <Fill field="contactEmail" label="contact email" />. You can also
        complain to your local data protection authority.
      </p>

      <h2>Children</h2>
      <p>
        Arcafold has no minimum age. If you are under the age at which you can agree to this policy
        where you live, a parent or guardian must agree to it for you.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we change this policy, we’ll update the date at the top, and tell you in the app or by
        email before significant changes take effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <Fill field="contactEmail" label="contact email" />. See also our{' '}
        <Link to={paths.terms}>Terms of Use</Link>.
      </p>
    </LegalPage>
  );
}
