# Twofold — rules for every task
- End-to-end encrypted. The server must never see plaintext photos,
  passwords, or keys.
- All crypto goes through packages/crypto (libsodium). Never write
  new crypto elsewhere.
- Never log keys, passwords, or decrypted data.
- Never store decrypted images in localStorage, IndexedDB, or disk cache.
- Object names in R2 are random IDs, never filenames.
- Every crypto change needs tests, including failure cases.
- Keep PRs small: one feature per branch.
