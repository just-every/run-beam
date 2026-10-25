// Browser form journeys for the two model preparation flows, with only the paid edge substituted.
import { courseLocaleCheck } from './regression-course-locales.mjs'
import { modelCourseCheck } from './regression-model-course.mjs'
process.env.BEAM_LANGUAGE_BROWSER = '1'
await courseLocaleCheck()
await modelCourseCheck()
console.log('PASS model preparation browser journeys')
