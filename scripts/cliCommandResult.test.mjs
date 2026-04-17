import { describe, expect, it } from 'vitest'

import { extractCommandResult } from './cliCommandResult.mjs'

describe('cliCommandResult', () => {
  it('extracts the top-level command result when nested data also contains status fields', () => {
    const output = `
warming up...
{"status":"success","data":{"jobs":[{"id":"job-1","status":"ready"}],"summary":{"status":"ok"}},"error":null}
`

    expect(extractCommandResult(output)).toEqual({
      status: 'success',
      data: {
        jobs: [{ id: 'job-1', status: 'ready' }],
        summary: { status: 'ok' }
      },
      error: null
    })
  })
})
