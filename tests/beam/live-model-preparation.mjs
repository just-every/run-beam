// Held-key qualification uses the exact same built-page and API journeys as the paid-edge checks.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { courseLocaleCheck } from './regression-course-locales.mjs'
import { modelCourseCheck } from './regression-model-course.mjs'
assert.equal(process.env.BEAM_LIVE_PROOF, '1', 'Explicit held-account qualification required')
assert.ok(process.env.BEAM_MODEL_KEY, 'Inject the held key only through the approved env door')
console.log('Live candidate', execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
if (!process.argv.includes('--course-only')) await courseLocaleCheck({ live: true })
if (!process.argv.includes('--locale-only')) await modelCourseCheck({ live: true })
console.log('PASS held-account preparation qualification')
