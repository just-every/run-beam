// Exact-candidate qualification against the real official SQL LRS, outside push Verify.
// Run through heavy-slot with BEAM_LIVE_PROOF=1 and BEAM_SQL_LRS_DIRECTORY set to its extracted standalone distribution.
import { execFileSync } from 'node:child_process'
import { realLrs } from './xapi-lrs.mjs'
import { xapiFixture } from './xapi-fixture.mjs'
import { xapiCheck } from './regression-xapi.mjs'
import { xapiBrowser } from './xapi-browser.mjs'
import { realActivity } from './xapi-activity.mjs'
const lrs = await realLrs()
let f, activity
try {
  f = await xapiFixture({ liveEndpoint: lrs.endpoint }); f.live = true
  const result = process.argv.includes('--browser-only') ? null : await xapiCheck(f)
  if (result) console.log('PASS independent SQL LRS: authenticated connect, actor/activity/registration, duplicate and foreign refusal, retained original statement/attachment, trusted mapping/native gate, procedure impact/export, revocation', result.statement)
  if (process.argv.includes('--browser')) {
    activity = await realActivity(f)
    await xapiBrowser(f, activity)
    console.log('PASS actual authorized activity and Beam browser end states at 1440/390')
  }
  console.log('Candidate', execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
} finally {
  try { if (activity) await activity.close() } finally { try { if (f) await f.h.close() } finally { await lrs.close() } }
}
console.log('PASS isolated LRS, activity server and browsers stopped')
