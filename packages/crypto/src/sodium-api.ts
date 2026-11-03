/**
 * The libsodium calls @arcafold/crypto makes, in the forms it makes them. Both builds of
 * libsodium satisfy it: the WebAssembly one (libsodium-wrappers-sumo) in browsers, Workers
 * and Node, and the native C one (react-native-libsodium) in the phone apps.
 */

/** Opaque secretstream state. Only the build that created it can use it. */
export type SecretstreamState = object;

export interface Sodium {
  readonly crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    additionalData: Uint8Array | null,
    secretNonce: null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    secretNonce: null,
    ciphertext: Uint8Array,
    additionalData: Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;

  readonly crypto_box_MACBYTES: number;
  readonly crypto_box_NONCEBYTES: number;
  readonly crypto_box_PUBLICKEYBYTES: number;
  readonly crypto_box_SECRETKEYBYTES: number;
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_easy(
    message: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;
  crypto_box_open_easy(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  crypto_box_seal_open(
    ciphertext: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ): Uint8Array;
  crypto_scalarmult_base(secretKey: Uint8Array): Uint8Array;

  readonly crypto_generichash_KEYBYTES: number;
  crypto_generichash(hashLength: number, message: Uint8Array, key: Uint8Array | null): Uint8Array;
  crypto_hash_sha256(message: Uint8Array): Uint8Array;

  crypto_kdf_keygen(): Uint8Array;
  crypto_kdf_derive_from_key(
    subkeyLength: number,
    subkeyId: number,
    context: string,
    key: Uint8Array,
  ): Uint8Array;

  readonly crypto_pwhash_ALG_ARGON2ID13: number;
  crypto_pwhash(
    keyLength: number,
    password: string | Uint8Array,
    salt: Uint8Array,
    opsLimit: number,
    memLimit: number,
    algorithm: number,
  ): Uint8Array;

  readonly crypto_secretbox_NONCEBYTES: number;
  crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_secretbox_open_easy(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;

  readonly crypto_secretstream_xchacha20poly1305_TAG_MESSAGE: number;
  readonly crypto_secretstream_xchacha20poly1305_TAG_FINAL: number;
  crypto_secretstream_xchacha20poly1305_keygen(): Uint8Array;
  crypto_secretstream_xchacha20poly1305_init_push(key: Uint8Array): {
    state: SecretstreamState;
    header: Uint8Array;
  };
  crypto_secretstream_xchacha20poly1305_push(
    state: SecretstreamState,
    message: Uint8Array,
    additionalData: null,
    tag: number,
  ): Uint8Array;
  crypto_secretstream_xchacha20poly1305_init_pull(
    header: Uint8Array,
    key: Uint8Array,
  ): SecretstreamState;
  crypto_secretstream_xchacha20poly1305_pull(
    state: SecretstreamState,
    ciphertext: Uint8Array,
    additionalData: null,
  ): { message: Uint8Array; tag: number } | false;

  memcmp(a: Uint8Array, b: Uint8Array): boolean;
  memzero(bytes: Uint8Array): void;
  pad(data: Uint8Array, blockSize: number): Uint8Array;
  unpad(data: Uint8Array, blockSize: number): Uint8Array;
  randombytes_buf(length: number): Uint8Array;
  randombytes_uniform(upperBound: number): number;
}
