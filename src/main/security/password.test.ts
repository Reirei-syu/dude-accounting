import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password security', () => {
  it('hashes non-empty passwords and verifies correctly', () => {
    const hash = hashPassword('abc123!@#')
    expect(hash).not.toBe('abc123!@#')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('abc123!@#', hash).valid).toBe(true)
    expect(verifyPassword('wrong-pass', hash).valid).toBe(false)
  })

  it('keeps empty password behavior for admin bootstrap', () => {
    expect(hashPassword('')).toBe('')
    expect(verifyPassword('', '').valid).toBe(true)
    expect(verifyPassword('any', '').valid).toBe(false)
  })

  it('supports legacy plaintext hashes and marks for upgrade', () => {
    const result = verifyPassword('legacy-pass', 'legacy-pass')
    expect(result.valid).toBe(true)
    expect(result.needsUpgrade).toBe(true)
  })
})
