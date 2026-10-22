import type { PackageManifest, PackageSco, PackageStandard } from './types.ts'

type State = Record<string, string>

/** Self-contained so the exact same model can run in the isolated SCO frame. */
export function createRuntimeModel(standard: PackageStandard) {
  const legacy = standard === '1.2'
  const status = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted']
  const completion = ['completed', 'incomplete', 'not attempted', 'unknown']
  const success = ['passed', 'failed', 'unknown']
  const interactionTypes = ['true-false', 'choice', 'fill-in', 'matching', 'performance', 'sequencing', 'likert', 'numeric', ...(legacy ? [] : ['long-fill-in', 'other'])]
  type Rule = { access: 'r' | 'w' | 'rw'; kind?: string; limit?: number; choices?: string[]; min?: number; max?: number }
  const rules: Record<string, Rule> = Object.create(null)
  const add = (key: string, access: Rule['access'], kind = 'text', extra: Partial<Rule> = {}) => { rules[key] = { access, kind, ...extra } }
  const text = (key: string, limit: number, access: Rule['access'] = 'rw') => add(key, access, 'text', { limit })
  const vocab = (key: string, choices: string[], access: Rule['access'] = 'rw') => add(key, access, 'vocab', { choices })
  const number = (key: string, min?: number, max?: number, access: Rule['access'] = 'rw') => add(key, access, 'number', { min, max })
  const prefix = legacy ? 'cmi.core.' : 'cmi.'
  text(prefix + (legacy ? 'student_id' : 'learner_id'), 4000, 'r')
  text(prefix + (legacy ? 'student_name' : 'learner_name'), 4000, 'r')
  text(prefix + (legacy ? 'lesson_location' : 'location'), legacy ? 255 : 1000)
  vocab(prefix + 'credit', ['credit', 'no-credit'], 'r')
  vocab(prefix + (legacy ? 'lesson_mode' : 'mode'), ['normal', 'browse', 'review'], 'r')
  vocab(prefix + 'entry', ['ab-initio', 'resume', ''], 'r')
  vocab(prefix + 'exit', legacy ? ['time-out', 'suspend', 'logout', ''] : ['time-out', 'suspend', 'logout', 'normal', ''], 'w')
  add(prefix + 'session_time', 'w', 'duration')
  add(prefix + 'total_time', 'r', 'duration')
  text('cmi.suspend_data', legacy ? 4096 : 64000)
  text('cmi.launch_data', legacy ? 4096 : 4000, 'r')
  for (const field of ['raw', 'min', 'max']) number(prefix + 'score.' + field, legacy ? 0 : undefined, legacy ? 100 : undefined)
  if (legacy) {
    vocab('cmi.core.lesson_status', status)
    number('cmi.student_data.mastery_score', 0, 100, 'r')
    add('cmi.student_data.max_time_allowed', 'r', 'duration')
    vocab('cmi.student_data.time_limit_action', ['exit,message', 'continue,message', 'exit,no message', 'continue,no message'], 'r')
    text('cmi.comments', 4096)
    text('cmi.comments_from_lms', 4096, 'r')
    number('cmi.student_preference.audio', -1, 100)
    text('cmi.student_preference.language', 255)
    number('cmi.student_preference.speed', -100, 100)
    number('cmi.student_preference.text', -1, 1)
  } else {
    vocab('cmi.completion_status', completion)
    vocab('cmi.success_status', success)
    number('cmi.score.scaled', -1, 1)
    number('cmi.progress_measure', 0, 1)
    number('cmi.completion_threshold', 0, 1, 'r')
    number('cmi.scaled_passing_score', -1, 1, 'r')
    add('cmi.max_time_allowed', 'r', 'duration')
    vocab('cmi.time_limit_action', ['exit,message', 'continue,message', 'exit,no message', 'continue,no message'], 'r')
    text('cmi._version', 20, 'r')
    number('cmi.learner_preference.audio_level', 0)
    text('cmi.learner_preference.language', 250)
    number('cmi.learner_preference.delivery_speed', 0)
    number('cmi.learner_preference.audio_captioning', -1, 1)
    add('adl.nav.request', 'rw', 'navigation')
  }
  function fail(code: number, message: string): never { throw Object.assign(new Error(message), { code: String(code) }) }
  function seconds(value: string): number | null {
    if (legacy) {
      const match = /^(\d{2,4}):([0-5]\d):([0-5]\d)(?:\.(\d{1,2}))?$/.exec(value)
      return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number('0.' + (match[4] || '0')) : null
    }
    const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,2})?)S)?)?$/.exec(value)
    if (!match || !match.slice(1).some(v => v !== undefined) || value.endsWith('T')) return null
    const result = Number(match[1] || 0) * 31536000 + Number(match[2] || 0) * 2592000 + Number(match[3] || 0) * 86400 + Number(match[4] || 0) * 3600 + Number(match[5] || 0) * 60 + Number(match[6] || 0)
    return Number.isFinite(result) && result <= 1e12 ? result : null
  }
  function count(state: State, collection: string): number {
    const indexes = new Set<number>()
    for (const key of Object.keys(state)) {
      if (!key.startsWith(collection + '.')) continue
      const part = key.slice(collection.length + 1).split('.')[0]
      if (/^(0|[1-9]\d*)$/.test(part)) indexes.add(Number(part))
    }
    return indexes.size
  }
  function rule(key: string): Rule | undefined {
    if (rules[key]) return rules[key]
    if (key.endsWith('._count') && (/^(cmi\.(objectives|interactions)|cmi\.interactions\.(0|[1-9]\d*)\.(objectives|correct_responses))\._count$/.test(key) || (!legacy && /^cmi\.comments_from_(learner|lms)\._count$/.test(key)))) return { access: 'r', kind: 'count' }
    if (key.endsWith('._children') && children(key.slice(0, -10)) !== null) return { access: 'r', kind: 'children' }
    const objective = /^cmi\.objectives\.(0|[1-9]\d*)\.(.+)$/.exec(key)
    if (objective) {
      const field = objective[2]
      if (field === 'id') return { access: 'rw', kind: 'id', limit: legacy ? 255 : 4000 }
      if (/^score\.(raw|min|max)$/.test(field)) return { access: 'rw', kind: 'number', min: legacy ? 0 : undefined, max: legacy ? 100 : undefined }
      if (legacy && field === 'status') return { access: 'rw', kind: 'vocab', choices: status }
      if (!legacy && field === 'completion_status') return { access: 'rw', kind: 'vocab', choices: completion }
      if (!legacy && field === 'success_status') return { access: 'rw', kind: 'vocab', choices: success }
      if (!legacy && field === 'score.scaled') return { access: 'rw', kind: 'number', min: -1, max: 1 }
      if (!legacy && field === 'progress_measure') return { access: 'rw', kind: 'number', min: 0, max: 1 }
      if (!legacy && field === 'description') return { access: 'rw', kind: 'text', limit: 250 }
    }
    const interaction = /^cmi\.interactions\.(0|[1-9]\d*)\.(.+)$/.exec(key)
    if (interaction) {
      const field = interaction[2], access = legacy ? 'w' : 'rw'
      if (field === 'id' || /^objectives\.(0|[1-9]\d*)\.id$/.test(field)) return { access, kind: 'id', limit: legacy ? 255 : 4000 }
      if (field === 'type') return { access, kind: 'vocab', choices: interactionTypes }
      if (field === (legacy ? 'time' : 'timestamp')) return { access, kind: legacy ? 'clock' : 'timestamp' }
      if (field === 'weighting') return { access, kind: 'number' }
      if (field === 'result') return { access, kind: 'result' }
      if (field === 'latency') return { access, kind: 'duration' }
      if (field === (legacy ? 'student_response' : 'learner_response') || /^correct_responses\.(0|[1-9]\d*)\.pattern$/.test(field)) return { access, kind: 'response', limit: legacy ? 255 : 4000 }
      if (!legacy && field === 'description') return { access, kind: 'text', limit: 250 }
    }
    if (!legacy && /^cmi\.comments_from_(learner|lms)\.(0|[1-9]\d*)\.(comment|location|timestamp)$/.test(key)) return { access: key.startsWith('cmi.comments_from_lms.') ? 'r' : 'rw', kind: key.endsWith('.timestamp') ? 'timestamp' : 'text', limit: key.endsWith('.comment') ? 4000 : 250 }
    if (!legacy && /^adl\.nav\.request_valid\.(continue|previous|choice\.\{target=[^{}]+\})$/.test(key)) return { access: 'r', kind: 'vocab', choices: ['true', 'false', 'unknown'] }
    return undefined
  }
  function children(key: string): string | null {
    if (key === 'cmi') return legacy ? 'core,suspend_data,launch_data,comments,comments_from_lms,objectives,student_data,student_preference,interactions' : '_version,comments_from_learner,comments_from_lms,completion_status,completion_threshold,credit,entry,exit,interactions,launch_data,learner_id,learner_name,learner_preference,location,max_time_allowed,mode,objectives,progress_measure,scaled_passing_score,score,session_time,success_status,suspend_data,time_limit_action,total_time'
    if (key === 'cmi.core' && legacy) return 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time'
    if (key === 'cmi.objectives') return legacy ? 'id,score,status' : 'id,score,success_status,completion_status,progress_measure,description'
    if (key === 'cmi.interactions') return legacy ? 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency' : 'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description'
    if (/^cmi\.interactions\.\d+\.objectives$/.test(key)) return 'id'
    if (/^cmi\.interactions\.\d+\.correct_responses$/.test(key)) return 'pattern'
    if ((key === prefix + 'score') || /^cmi\.objectives\.\d+\.score$/.test(key)) return legacy ? 'raw,min,max' : 'scaled,raw,min,max'
    if (!legacy && /^cmi\.comments_from_(learner|lms)$/.test(key)) return 'comment,location,timestamp'
    if (key === (legacy ? 'cmi.student_preference' : 'cmi.learner_preference')) return legacy ? 'audio,language,speed,text' : 'audio_level,language,delivery_speed,audio_captioning'
    if (legacy && key === 'cmi.student_data') return 'mastery_score,max_time_allowed,time_limit_action'
    return null
  }
  function get(state: State, key: string): string {
    const spec = rule(key)
    if (!spec) return fail(legacy ? key.endsWith('._children') ? 202 : key.endsWith('._count') ? 203 : 201 : 401, 'Unknown data model element: ' + key)
    if (spec.access === 'w') return fail(legacy ? 404 : 405, 'Data model element is write only: ' + key)
    if (spec.kind === 'count') return String(count(state, key.slice(0, -7)))
    if (spec.kind === 'children') return children(key.slice(0, -10)) || ''
    if (!legacy && key === 'cmi.completion_status' && state['cmi.completion_threshold'] !== undefined) return state['cmi.progress_measure'] === undefined ? 'unknown' : Number(state['cmi.progress_measure']) >= Number(state['cmi.completion_threshold']) ? 'completed' : 'incomplete'
    if (!legacy && key === 'cmi.success_status' && state['cmi.scaled_passing_score'] !== undefined) return state['cmi.score.scaled'] === undefined ? 'unknown' : Number(state['cmi.score.scaled']) >= Number(state['cmi.scaled_passing_score']) ? 'passed' : 'failed'
    if (Object.hasOwn(state, key)) return state[key]
    if (!legacy && /^cmi\.objectives\.\d+\.(success_status|completion_status)$/.test(key) && Object.hasOwn(state, key.slice(0, key.lastIndexOf('.') + 1) + 'id')) return 'unknown'
    if (key.startsWith('adl.nav.request_valid.')) return 'unknown'
    if (legacy) return ''
    return fail(403, 'Data model element is not initialized: ' + key)
  }
  function set(state: State, key: string, value: string): void {
    const spec = rule(key)
    if (!spec) fail(legacy ? 201 : 401, 'Unknown data model element: ' + key)
    if (spec.access === 'r') fail(legacy ? (key.endsWith('._count') || key.endsWith('._children') ? 402 : 403) : 404, 'Data model element is read only: ' + key)
    const bad = () => fail(legacy ? 405 : 406, 'Invalid value for ' + key)
    if (typeof value !== 'string' || /[\u0000]/.test(value) || (spec.limit !== undefined && value.length > spec.limit)) bad()
    if (spec.kind === 'vocab' && !spec.choices?.includes(value)) bad()
    if (spec.kind === 'id' && (!value || /\s/.test(value))) bad()
    if (spec.kind === 'number') {
      if (!(legacy && value === '') && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)))) bad()
      if (value !== '' && ((spec.min !== undefined && Number(value) < spec.min) || (spec.max !== undefined && Number(value) > spec.max))) fail(legacy ? 405 : 407, 'Value outside allowed range: ' + key)
      if (/(audio_captioning|\.text)$/.test(key) && !['-1', '0', '1'].includes(value)) bad()
    }
    if (spec.kind === 'duration' && seconds(value) === null) bad()
    if (spec.kind === 'clock' && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,2})?$/.test(value)) bad()
    if (spec.kind === 'timestamp') {
      const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,2})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.exec(value)
      if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || Number(match[3]) < 1 || Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() || !Number.isFinite(Date.parse(value))) bad()
    }
    if (spec.kind === 'result' && ![...(legacy ? ['correct', 'wrong', 'unanticipated', 'neutral'] : ['correct', 'incorrect', 'unanticipated', 'neutral'])].includes(value) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) bad()
    if (spec.kind === 'navigation' && !/^(_none_|continue|previous|exit|exitAll|abandon|abandonAll|suspendAll|\{target=[^{}]+\}(choice|jump))$/.test(value)) bad()
    const collection = /^(cmi\.(objectives|interactions))\.(0|[1-9]\d*)\.(.+)$/.exec(key)
    if (collection) {
      const base = collection[1] + '.' + collection[3], field = collection[4], index = Number(collection[3])
      if (index > count(state, collection[1])) fail(legacy ? 201 : 351, 'Collection indexes must be sequential')
      if (field !== 'id' && !Object.hasOwn(state, base + '.id')) fail(legacy ? 201 : 408, 'Set the collection id first')
      if (field === 'id') {
        for (const [other, id] of Object.entries(state)) if (other !== key && new RegExp('^' + collection[1].replaceAll('.', '\\.') + '\\.\\d+\\.id$').test(other) && id === value) fail(legacy ? 405 : 351, 'Duplicate collection identifier')
        if (state[key] !== undefined && state[key] !== value) fail(legacy ? 405 : 351, 'Collection identifiers cannot be replaced')
      }
      const nested = /^(objectives|correct_responses)\.(0|[1-9]\d*)\./.exec(field)
      if (nested && Number(nested[2]) > count(state, base + '.' + nested[1])) fail(legacy ? 201 : 351, 'Collection indexes must be sequential')
      if (nested && spec.kind === 'id') {
        const start = base + '.' + nested[1] + '.'
        if (Object.entries(state).some(([other, id]) => other !== key && other.startsWith(start) && other.endsWith('.id') && id === value)) fail(legacy ? 405 : 351, 'Duplicate nested objective identifier')
      }
      if (collection[2] === 'interactions' && spec.kind === 'response') {
        const type = state[base + '.type']
        if (!type) fail(legacy ? 201 : 408, 'Set interaction type before its response')
        if (type === 'true-false' && !(legacy ? ['0', '1'] : ['true', 'false']).includes(value)) bad()
        const pattern = field.startsWith('correct_responses.')
        const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
        if (type === 'numeric') {
          const values = pattern ? value.split(legacy ? ':' : '[:]') : [value]
          if (values.length > 2 || values.some(part => !decimal.test(part) || !Number.isFinite(Number(part))) || (values.length === 2 && Number(values[0]) > Number(values[1]))) bad()
        }
        if (['choice', 'sequencing', 'matching', 'likert'].includes(type)) {
          const parts = type === 'likert' ? [value] : value.split(legacy ? ',' : '[,]')
          if (parts.some(part => !part || /\s/.test(part)) || new Set(parts).size !== parts.length) bad()
          if (type === 'matching' && parts.some(part => { const pair = part.split(legacy ? '.' : '[.]'); return pair.length !== 2 || pair.some(id => !id) })) bad()
          if (type !== 'matching' && parts.some(part => part.includes(legacy ? '.' : '[.]') || part.includes('[,]'))) bad()
        }
      }
    }
    const comment = /^(cmi\.comments_from_learner)\.(0|[1-9]\d*)\./.exec(key)
    if (comment && Number(comment[2]) > count(state, comment[1])) fail(351, 'Collection indexes must be sequential')
    state[key] = value
  }
  function validateScores(state: State) {
    for (const key of Object.keys(state)) {
      if (!key.endsWith('.score.raw') && !key.endsWith('.score.min') && !key.endsWith('.score.max')) continue
      const base = key.slice(0, key.lastIndexOf('.') + 1)
      const raw = state[base + 'raw'], min = state[base + 'min'], max = state[base + 'max']
      if ((min !== undefined && min !== '' && max !== undefined && max !== '' && Number(min) > Number(max)) || (raw !== undefined && raw !== '' && ((min !== undefined && min !== '' && Number(raw) < Number(min)) || (max !== undefined && max !== '' && Number(raw) > Number(max))))) fail(legacy ? 405 : 407, 'Score is outside its declared range')
    }
  }
  return { get, set, rule, seconds, validateScores }
}

export function initialState(standard: PackageStandard, previous: State, learner: { id: string; name: string }, sco: PackageSco): State {
  const legacy = standard === '1.2', prefix = legacy ? 'cmi.core.' : 'cmi.'
  const resumed = previous[prefix + 'exit'] === 'suspend'
  const state: State = { ...previous,
    [prefix + (legacy ? 'student_id' : 'learner_id')]: learner.id,
    [prefix + (legacy ? 'student_name' : 'learner_name')]: learner.name,
    [prefix + 'credit']: 'credit', [prefix + (legacy ? 'lesson_mode' : 'mode')]: 'normal',
    [prefix + 'entry']: resumed ? 'resume' : Object.keys(previous).length ? '' : 'ab-initio',
    [prefix + 'exit']: '', [prefix + 'session_time']: legacy ? '0000:00:00.00' : 'PT0S',
    [prefix + 'total_time']: previous[prefix + 'total_time'] || (legacy ? '0000:00:00.00' : 'PT0S'),
    [prefix + (legacy ? 'lesson_location' : 'location')]: previous[prefix + (legacy ? 'lesson_location' : 'location')] || '',
    'cmi.suspend_data': previous['cmi.suspend_data'] || '', 'cmi.launch_data': sco.dataFromLMS || '',
  }
  if (legacy) {
    state['cmi.core.lesson_status'] ||= 'not attempted'
    state['cmi.comments'] ||= ''; state['cmi.comments_from_lms'] ||= ''
    for (const key of ['raw', 'min', 'max']) state['cmi.core.score.' + key] ??= ''
    state['cmi.student_data.mastery_score'] = sco.masteryScore === null ? '' : String(sco.masteryScore)
  } else {
    state['cmi._version'] = '1.0'
    state['cmi.completion_status'] ||= 'unknown'; state['cmi.success_status'] ||= 'unknown'
    state['adl.nav.request'] = '_none_'
    if (sco.successThreshold != null) state['cmi.scaled_passing_score'] = String(sco.successThreshold)
    if (sco.completionThreshold != null) state['cmi.completion_threshold'] = String(sco.completionThreshold)
  }
  for (const [index, id] of (sco.objectiveIds || []).entries()) state['cmi.objectives.' + index + '.id'] ??= id
  return state
}

/** Validate snapshots atomically; SCOs cannot change server-owned learner/launch fields. */
export function applyRuntime(manifest: PackageManifest, sco: PackageSco, previous: State, values: State): State {
  const model = createRuntimeModel(manifest.standard)
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 12000) throw Object.assign(new Error('Invalid runtime values'), { code: '201' })
  const legacy = manifest.standard === '1.2', prefix = legacy ? 'cmi.core.' : 'cmi.'
  const defaults = initialState(manifest.standard, previous, { id: previous[prefix + (legacy ? 'student_id' : 'learner_id')] || '', name: previous[prefix + (legacy ? 'student_name' : 'learner_name')] || '' }, sco)
  const state: State = { ...defaults, ...previous, 'cmi.launch_data': sco.dataFromLMS || '' }
  for (const key of ['cmi.student_data.mastery_score', 'cmi.scaled_passing_score', 'cmi.completion_threshold']) {
    if (defaults[key] !== undefined) state[key] = defaults[key]
  }
  const priority = (key: string) => key.endsWith('.id') ? 0 : key.endsWith('.type') ? 1 : 2
  const entries = Object.entries(values).sort(([a], [b]) => a.split('.').length - b.split('.').length || priority(a) - priority(b) || a.localeCompare(b, 'en', { numeric: true }))
  for (const [key, value] of entries) {
    if (typeof value !== 'string') throw Object.assign(new Error('Runtime values must be strings'), { code: legacy ? '405' : '406' })
    if (model.rule(key)?.access === 'r') continue
    model.set(state, key, value)
  }
  for (const [key, value] of entries) if (model.rule(key)?.access === 'r' && model.get(state, key) !== value) throw Object.assign(new Error('Read-only runtime value: ' + key), { code: legacy ? '403' : '404' })
  model.validateScores(state)
  return state
}

export function outcome(standard: PackageStandard, sco: PackageSco, state: State): { completed: boolean; passed: boolean; failed: boolean } {
  if (standard === '1.2') {
    const status = state['cmi.core.lesson_status']
    const score = state['cmi.core.score.raw'], hasMastery = sco.masteryScore !== null && score !== undefined && score !== ''
    const failed = status === 'failed' || (hasMastery && Number(score) < sco.masteryScore!)
    return { completed: !failed && (status === 'completed' || status === 'passed'), passed: !failed && (status === 'passed' || (hasMastery && Number(score) >= sco.masteryScore!)), failed }
  }
  const scaled = state['cmi.score.scaled'], progress = state['cmi.progress_measure']
  const measuredSuccess = sco.successThreshold != null && scaled !== undefined && scaled !== ''
  let failed = state['cmi.success_status'] === 'failed' || (measuredSuccess && Number(scaled) < sco.successThreshold!)
  const passed = !failed && (state['cmi.success_status'] === 'passed' || (measuredSuccess && Number(scaled) >= sco.successThreshold!))
  const completed = sco.completionThreshold != null ? progress !== undefined && progress !== '' && Number(progress) >= sco.completionThreshold : state['cmi.completion_status'] === 'completed'
  let blocked = false
  for (const key of Object.keys(state)) {
    if (!/^cmi\.objectives\.\d+\.id$/.test(key)) continue
    const base = key.slice(0, -2)
    const success = state[base + 'success_status'], completion = state[base + 'completion_status']
    if (success === 'failed') { failed = true; blocked = true }
    if (completion === 'incomplete' || completion === 'not attempted') blocked = true
  }
  return { completed: completed && !blocked, passed: passed && !failed && !blocked, failed }
}

export function sessionSeconds(standard: PackageStandard, state: State): number {
  return createRuntimeModel(standard).seconds(state[standard === '1.2' ? 'cmi.core.session_time' : 'cmi.session_time'] || '') || 0
}

export function totalTime(standard: PackageStandard, seconds: number): string {
  const centiseconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds * 100 : 0))
  if (standard !== '1.2') return 'PT' + (centiseconds / 100) + 'S'
  const hours = Math.floor(centiseconds / 360000), minutes = Math.floor(centiseconds / 6000) % 60, remainder = (centiseconds % 6000) / 100
  return String(Math.min(hours, 9999)).padStart(4, '0') + ':' + String(minutes).padStart(2, '0') + ':' + remainder.toFixed(2).padStart(5, '0')
}
