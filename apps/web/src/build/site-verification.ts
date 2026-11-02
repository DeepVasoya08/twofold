/**
 * Google Search Console's ownership check: a `google-site-verification` meta tag on the home
 * page, which Google needs before it shows Twofold's name and logo on the "Connect Google
 * Photos" sign-in screen. The token comes from the GOOGLE_SITE_VERIFICATION Actions variable at
 * build time (docs/deployment.md); it is public by design, since anyone can read the page.
 */
export function siteVerificationTag(token: string | undefined): string | null {
  const value = token?.trim() ?? '';
  // Search Console tokens are URL-safe base64; anything else is a mistake, so leave it out.
  if (!/^[\w-]{10,100}$/.test(value)) return null;
  return `<meta name="google-site-verification" content="${value}" />`;
}
