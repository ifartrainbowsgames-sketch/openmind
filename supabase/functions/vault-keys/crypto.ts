// AES-256-GCM envelope encryption for customer provider keys.
//
// The master secret (KEY_ENCRYPTION_SECRET) lives in function/worker config and
// never reaches the browser. A fresh 12-byte IV per encryption is required —
// reusing an IV with the same key breaks GCM catastrophically, leaking the
// authentication key, so it is generated per call and stored beside the
// ciphertext rather than derived from anything.
//
// This is envelope encryption with the master key in environment config, not an
// HSM: an attacker with both the database and the environment can decrypt.
// It defends against a database dump alone, which is the realistic exposure.

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

export interface SealedKey {
  ciphertext: string
  iv: string
  hint: string
}

/**
 * SHA-256 of the secret gives a fixed 32-byte AES key from a secret of any
 * length. A passphrase-derived KDF (PBKDF2/scrypt) would be stronger against a
 * weak secret — generate a long random secret and this is equivalent.
 */
async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 16) {
    throw new Error('KEY_ENCRYPTION_SECRET missing or too short (need 16+ chars)')
  }
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// Annotated with the concrete buffer type: a bare Uint8Array widens to
// ArrayBufferLike, which crypto.subtle will not accept as a BufferSource.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Last four characters, so the UI can say which key is stored without holding it. */
export function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim()
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`
}

export async function sealKey(plaintext: string, secret: string): Promise<SealedKey> {
  const key = await importKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENCODER.encode(plaintext))
  return {
    ciphertext: toBase64(new Uint8Array(sealed)),
    iv: toBase64(iv),
    hint: keyHint(plaintext),
  }
}

export async function openKey(sealed: { ciphertext: string; iv: string }, secret: string): Promise<string> {
  const key = await importKey(secret)
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.ciphertext),
  )
  return DECODER.decode(opened)
}
