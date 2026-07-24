import { decryptSecret, encryptSecret, pkceChallenge } from './oauth-vault.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test('OAuth vault encrypts and decrypts without plaintext leakage', async () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  Deno.env.set('OAUTH_TOKEN_ENCRYPTION_KEY', key)
  const ciphertext = await encryptSecret('github-secret-token')
  assert(ciphertext.startsWith('v1.'), 'ciphertext should carry a key format version')
  assert(!ciphertext.includes('github-secret-token'), 'ciphertext must not contain plaintext')
  assert(await decryptSecret(ciphertext) === 'github-secret-token', 'decrypted token should match')
})

Deno.test('PKCE challenge matches the RFC 7636 S256 example', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  assert(
    await pkceChallenge(verifier) === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    'PKCE S256 challenge should match RFC 7636',
  )
})
