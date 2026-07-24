const encoder = new TextEncoder()
const decoder = new TextDecoder()
function additionalData(context?: string): Uint8Array {
  return encoder.encode(`openmind-connector-v1:${context ?? 'default'}`)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function encryptionKey(): Promise<CryptoKey> {
  const configured = Deno.env.get('OAUTH_TOKEN_ENCRYPTION_KEY')
  if (!configured) throw new Error('OAuth token encryption key is not configured')
  const raw = fromBase64Url(configured.trim())
  if (raw.byteLength !== 32) throw new Error('OAuth token encryption key must decode to 32 bytes')
  return crypto.subtle.importKey('raw', arrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function randomBase64Url(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64Url(new Uint8Array(digest))
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return sha256Base64Url(verifier)
}

export async function encryptSecret(value: string, context?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(context) },
    await encryptionKey(),
    encoder.encode(value),
  )
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`
}

export async function decryptSecret(value: string, context?: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new Error('Unsupported OAuth ciphertext')
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: arrayBuffer(fromBase64Url(encodedIv)),
      additionalData: additionalData(context),
    },
    await encryptionKey(),
    arrayBuffer(fromBase64Url(encodedCiphertext)),
  )
  return decoder.decode(plaintext)
}
