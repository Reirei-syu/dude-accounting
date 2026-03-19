import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEV_USER_DATA_DIR_NAME, getRuntimeUserDataPath } from './runtimeAppPaths'

describe('runtimeAppPaths service', () => {
  it('uses a dedicated userData directory in development mode', () => {
    expect(getRuntimeUserDataPath('C:/Users/test/AppData/Roaming', true)).toBe(
      path.join('C:/Users/test/AppData/Roaming', DEV_USER_DATA_DIR_NAME)
    )
  })

  it('keeps the platform default userData path in packaged mode', () => {
    expect(getRuntimeUserDataPath('C:/Users/test/AppData/Roaming', false)).toBeNull()
  })
})
