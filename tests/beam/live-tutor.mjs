import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { tutorCheck } from './regression-tutor.mjs'
assert.equal(process.env.BEAM_LIVE_PROOF,'1')
assert.ok(process.env.BEAM_MODEL_KEY,'Held model key must be injected by the approved fleet helper')
console.log('Live tutor candidate',execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())
await tutorCheck({live:true})
console.log('PASS held-account tutor qualification')
