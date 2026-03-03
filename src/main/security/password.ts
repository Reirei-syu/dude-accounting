import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const HASH_PREFIX = 'scrypt'
const SCRYPT_KEY_LENGTH = 64

function encodeHash(salt: Buffer, derivedKey: Buffer): string {
  return `${HASH_PREFIX}$${salt.toString('base64')}$${derivedKey.toString('base64')}`
}

function decodeHash(storedHash: string): { salt: Buffer; key: Buffer } | null {
  const [prefix, saltBase64, keyBase64] = storedHash.split('$')
  if (prefix !== HASH_PREFIX || !saltBase64 || !keyBase64) return null

  try {
    return {
      salt: Buffer.from(saltBase64, 'base64'),
      key: Buffer.from(keyBase64, 'base64')
    }
  } catch {
    return null
  }
}

export function hashPassword(password: string): string {
  if (password === '') return ''
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, SCRYPT_KEY_LENGTH)
  return encodeHash(salt, key)
}

export function verifyPassword(
  password: string,
  storedHash: string
): { valid: boolean; needsUpgrade: boolean } {
  if (storedHash === '') {
    return { valid: password === '', needsUpgrade: false }
  }

  const parsed = decodeHash(storedHash)
  if (parsed) {
    const candidateKey = scryptSync(password, parsed.salt, SCRYPT_KEY_LENGTH)
    if (candidateKey.length !== parsed.key.length) {
      return { valid: false, needsUpgrade: false }
    }
    return {
      valid: timingSafeEqual(candidateKey, parsed.key),
      needsUpgrade: false
    }
  }

  // Legacy plaintext compatibility: allow login once and upgrade hash immediately.
  const valid = password === storedHash
  return { valid, needsUpgrade: valid }
}
