import type {
  AccountResponse,
  DeleteAccountRequest,
  ErrorResponse,
  LoginRequest,
  PreLoginRequest,
  PreLoginResponse,
  SignUpRequest,
  UpdateKeyringRequest,
} from '@twofold/types';

/** A failed API call. `message` is written for people and safe to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const OFFLINE = "Couldn't reach Twofold. Check your connection and try again.";

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
  );
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
  if (res.status === 204) return undefined as T;
  const parsed: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      isErrorResponse(parsed) ? parsed.error : 'Something went wrong. Try again.',
    );
  }
  return parsed as T;
}

/** Typed calls to the Twofold API. Bodies carry derived keys, never passwords. */
export const api = {
  account: () => call<AccountResponse>('GET', '/account'),
  signUp: (body: SignUpRequest) => call<AccountResponse>('POST', '/auth/signup', body),
  preLogin: (body: PreLoginRequest) => call<PreLoginResponse>('POST', '/auth/prelogin', body),
  logIn: (body: LoginRequest) => call<AccountResponse>('POST', '/auth/login', body),
  logOut: () => call<undefined>('POST', '/auth/logout', {}),
  updateKeyring: (body: UpdateKeyringRequest) =>
    call<AccountResponse>('PUT', '/account/keyring', body),
  deleteAccount: (body: DeleteAccountRequest) => call<undefined>('DELETE', '/account', body),
};
