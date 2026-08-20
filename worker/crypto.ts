// Node-side mirror of supabase/functions/vault-keys/crypto.ts.
//
// Deliberately duplicated rather than imported: the Edge Function is deployed
// standalone by the Supabase CLI and cannot reach outside its own directory,
// while the worker builds from the repo root. Both use the same WebCrypto
// primitives, so the formats are identical — but if you change one, change the
// other, and the round-trip test in scripts/check-crypto.ts covers both.

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

export interface SealedKey {
  ciphertext: string
  iv: string
  hint: string
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 16) {
    throw new Error('KEY_ENCRYPTION_SECRET missing or too short (need 16+ chars)')
  }
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

// Concrete buffer type: a bare Uint8Array widens to ArrayBufferLike, which
// crypto.subtle rejects as a BufferSource.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, 'base64')
  const out = new Uint8Array(new ArrayBuffer(buf.length))
  out.set(buf)
  return out
}

export function keyHint(plaintext: string): string {
  const trimmed = plaintext.trim()
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`
}

export async function sealKey(plaintext: string, secret: string): Promise<SealedKey> {
  const key = await importKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENCODER.encode(plaintext))
  return { ciphertext: toBase64(new Uint8Array(sealed)), iv: toBase64(iv), hint: keyHint(plaintext) }
}

export async function openKey(
  sealed: { ciphertext: string; iv: string },
  secret: string,
): Promise<string> {
  const key = await importKey(secret)
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.ciphertext),
  )
  return DECODER.decode(opened)
}
