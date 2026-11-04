import { fetch } from 'expo/fetch';

import { configureApi } from '@arcafold/core/api';

import { apiConfig } from './config';

/**
 * Sets up the shared core for this phone. expo/fetch sends encrypted bytes as they are (React
 * Native's own fetch turns them into base64 first). Crypto loads with the core's default: on
 * a phone that is libsodium's native C library, so it needs no worker.
 */
configureApi(apiConfig((url, init) => fetch(url, init)));
