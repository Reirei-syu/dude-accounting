import { runCliE2E } from '../cli-release-e2e/run.mjs'

const result = await runCliE2E({
  surfaceMode: 'source'
})

console.log(JSON.stringify(result, null, 2))
