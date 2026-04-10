import { describe, expect, it } from 'vitest'
import { listCommandKeys } from '../main/commands/catalog'
import { listRegisteredCommandKeys } from './executor'

describe('cli registry parity', () => {
  it('keeps catalog metadata and executable registry in sync', () => {
    const catalogKeys = listCommandKeys().sort()
    const registryKeys = listRegisteredCommandKeys().sort()

    expect(registryKeys).toEqual(catalogKeys)
  })
})
