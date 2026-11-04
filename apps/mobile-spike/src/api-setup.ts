import { configureApi } from '@arcafold/core/api';
import { configureLibrary } from '@arcafold/core/library/space-store';
import { fetch } from 'expo/fetch';

/**
 * Points the shared API client at arcafold.com. expo/fetch sends encrypted bytes as they
 * are (React Native's own fetch turns them into base64 first), and the session cookie is
 * kept in memory by the client, never in the system cookie store.
 */
configureApi({
  origin: 'https://arcafold.com',
  fetch: (url, init) => fetch(url, init),
  cookies: 'memory',
});

/**
 * The spike never shows the photos it uploads, so the library store makes no image of them.
 * The real app will hand decrypted bytes to a native image view here, kept in memory only.
 */
configureLibrary({
  showImage: () => '',
  releaseImage: () => undefined,
});
