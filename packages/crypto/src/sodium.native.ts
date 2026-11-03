/**
 * libsodium for the phone apps: the native C library through react-native-libsodium's JSI
 * bindings, so Argon2id and file encryption run at native speed (Hermes has no WebAssembly).
 * Metro resolves `./sodium` to this file on iOS and Android; everything else uses sodium.ts.
 *
 * react-native-libsodium 1.7.0 does not bind secretstream, scalarmult_base, sha256, pad,
 * unpad or memcmp. patches/react-native-libsodium@1.7.0.patch adds them as direct calls into
 * the same C library (the `jsi_arcafold_*` globals below). This file only adapts types.
 */
import * as native from 'react-native-libsodium';

import type { SecretstreamState, Sodium } from './sodium-api';

declare global {
  var jsi_arcafold_secretstream_TAG_MESSAGE: number;
  var jsi_arcafold_secretstream_TAG_FINAL: number;
  var jsi_arcafold_aead_xchacha20poly1305_ietf_ABYTES: number;
  var jsi_arcafold_box_MACBYTES: number;
  function jsi_arcafold_secretstream_init_push(key: ArrayBuffer): {
    state: ArrayBuffer;
    header: ArrayBuffer;
  };
  function jsi_arcafold_secretstream_push(
    state: ArrayBuffer,
    message: ArrayBuffer,
    tag: number,
  ): ArrayBuffer;
  function jsi_arcafold_secretstream_init_pull(header: ArrayBuffer, key: ArrayBuffer): ArrayBuffer;
  function jsi_arcafold_secretstream_pull(
    state: ArrayBuffer,
    ciphertext: ArrayBuffer,
  ): { message: ArrayBuffer; tag: number } | null;
  function jsi_arcafold_scalarmult_base(secretKey: ArrayBuffer): ArrayBuffer;
  function jsi_arcafold_hash_sha256(message: ArrayBuffer): ArrayBuffer;
  function jsi_arcafold_pad(data: ArrayBuffer, blockSize: number): ArrayBuffer;
  function jsi_arcafold_unpad(data: ArrayBuffer, blockSize: number): number;
  function jsi_arcafold_memcmp(a: ArrayBuffer, b: ArrayBuffer): boolean;
}

/** The exact bytes of a view as a standalone ArrayBuffer (JSI reads whole buffers). */
function buffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/** A secretstream state lives in a JS-owned buffer that the C side updates in place. */
class NativeState {
  constructor(readonly bytes: ArrayBuffer) {}
}

function stateBytes(state: SecretstreamState): ArrayBuffer {
  if (!(state instanceof NativeState)) throw new TypeError('Not a native secretstream state');
  return state.bytes;
}

const sodium: Sodium = {
  crypto_aead_xchacha20poly1305_ietf_ABYTES:
    globalThis.jsi_arcafold_aead_xchacha20poly1305_ietf_ABYTES,
  crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: native.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  crypto_aead_xchacha20poly1305_ietf_encrypt: (message, additionalData, secretNonce, nonce, key) =>
    native.crypto_aead_xchacha20poly1305_ietf_encrypt(
      message,
      additionalData,
      secretNonce,
      nonce,
      key,
    ),
  crypto_aead_xchacha20poly1305_ietf_decrypt: (
    secretNonce,
    ciphertext,
    additionalData,
    nonce,
    key,
  ) =>
    native.crypto_aead_xchacha20poly1305_ietf_decrypt(
      secretNonce,
      ciphertext,
      additionalData,
      nonce,
      key,
    ),

  crypto_box_MACBYTES: globalThis.jsi_arcafold_box_MACBYTES,
  crypto_box_NONCEBYTES: native.crypto_box_NONCEBYTES,
  crypto_box_PUBLICKEYBYTES: native.crypto_box_PUBLICKEYBYTES,
  crypto_box_SECRETKEYBYTES: native.crypto_box_SECRETKEYBYTES,
  crypto_box_keypair: () => native.crypto_box_keypair(),
  crypto_box_easy: (message, nonce, publicKey, privateKey) =>
    native.crypto_box_easy(message, nonce, publicKey, privateKey),
  crypto_box_open_easy: (ciphertext, nonce, publicKey, privateKey) =>
    native.crypto_box_open_easy(ciphertext, nonce, publicKey, privateKey),
  crypto_box_seal: (message, publicKey) => native.crypto_box_seal(message, publicKey),
  crypto_box_seal_open: (ciphertext, publicKey, privateKey) =>
    native.crypto_box_seal_open(ciphertext, publicKey, privateKey),
  crypto_scalarmult_base: (secretKey) =>
    new Uint8Array(globalThis.jsi_arcafold_scalarmult_base(buffer(secretKey))),

  crypto_generichash_KEYBYTES: native.crypto_generichash_KEYBYTES,
  crypto_generichash: (hashLength, message, key) =>
    native.crypto_generichash(hashLength, message, key),
  crypto_hash_sha256: (message) =>
    new Uint8Array(globalThis.jsi_arcafold_hash_sha256(buffer(message))),

  crypto_kdf_keygen: () => native.crypto_kdf_keygen(),
  crypto_kdf_derive_from_key: (subkeyLength, subkeyId, context, key) =>
    native.crypto_kdf_derive_from_key(subkeyLength, subkeyId, context, key),

  crypto_pwhash_ALG_ARGON2ID13: native.crypto_pwhash_ALG_ARGON2ID13,
  crypto_pwhash: (keyLength, password, salt, opsLimit, memLimit, algorithm) =>
    native.crypto_pwhash(keyLength, password, salt, opsLimit, memLimit, algorithm),

  crypto_secretbox_NONCEBYTES: native.crypto_secretbox_NONCEBYTES,
  crypto_secretbox_easy: (message, nonce, key) => native.crypto_secretbox_easy(message, nonce, key),
  crypto_secretbox_open_easy: (ciphertext, nonce, key) =>
    native.crypto_secretbox_open_easy(ciphertext, nonce, key),

  crypto_secretstream_xchacha20poly1305_TAG_MESSAGE:
    globalThis.jsi_arcafold_secretstream_TAG_MESSAGE,
  crypto_secretstream_xchacha20poly1305_TAG_FINAL: globalThis.jsi_arcafold_secretstream_TAG_FINAL,
  crypto_secretstream_xchacha20poly1305_keygen: () => native.randombytes_buf(32),
  crypto_secretstream_xchacha20poly1305_init_push: (key) => {
    const { state, header } = globalThis.jsi_arcafold_secretstream_init_push(buffer(key));
    return { state: new NativeState(state), header: new Uint8Array(header) };
  },
  crypto_secretstream_xchacha20poly1305_push: (state, message, _additionalData, tag) =>
    new Uint8Array(
      globalThis.jsi_arcafold_secretstream_push(stateBytes(state), buffer(message), tag),
    ),
  crypto_secretstream_xchacha20poly1305_init_pull: (header, key) =>
    new NativeState(globalThis.jsi_arcafold_secretstream_init_pull(buffer(header), buffer(key))),
  crypto_secretstream_xchacha20poly1305_pull: (state, ciphertext) => {
    const result = globalThis.jsi_arcafold_secretstream_pull(stateBytes(state), buffer(ciphertext));
    return result ? { message: new Uint8Array(result.message), tag: result.tag } : false;
  },

  memcmp: (a, b) => globalThis.jsi_arcafold_memcmp(buffer(a), buffer(b)),
  memzero: (bytes) => {
    bytes.fill(0);
  },
  pad: (data, blockSize) => new Uint8Array(globalThis.jsi_arcafold_pad(buffer(data), blockSize)),
  unpad: (data, blockSize) =>
    data.subarray(0, globalThis.jsi_arcafold_unpad(buffer(data), blockSize)),
  randombytes_buf: (length) => native.randombytes_buf(length),
  randombytes_uniform: (upperBound) => native.randombytes_uniform(upperBound),
};

/** The native library is ready as soon as the module is installed. */
export function getSodium(): Promise<Sodium> {
  return Promise.resolve(sodium);
}
