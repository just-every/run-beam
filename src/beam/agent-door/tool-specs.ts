import type { ToolDefinition } from '../../modules/agent-door/index.ts'
import { array, choice, draftVersion, editing, flag, id, integer, listOutput, nullable, object, recordOutput, text } from './schema.ts'
import { blockSchema, draftProposal } from './schema-draft.ts'
import { outcomeSchema, preparationSchema } from './schema-preparation.ts'

export interface ToolSpec extends Pick<ToolDefinition, 'name' | 'title' | 'description' | 'scope' | 'readOnly' | 'inputSchema' | 'outputSchema' | 'classes' | 'clauses' | 'untrusted'> {
  /** Native service action or read route; :id takes the tool's id argument. */
  action?: string
  view?: string
  record?: { kind: 'course' | 'revision' | 'source_version' | 'notice' | 'proposal' | 'diagnosis_import' | 'intervention' | 'question_plan'; argument: string }
  material?: boolean
  privacy?: 'identity' | 'people' | 'report' | 'proposals' | 'proposal'
  draft?: boolean
}
type Details = Partial<Pick<ToolSpec, 'record' | 'material' | 'privacy' | 'draft'>>
const spec = (name: string, title: string, description: string, clauses: string[], inputSchema = object({}), details: Details = {}): ToolSpec => ({
  name: `beam.${name}`, scope: `beam.${name}`, title, description, clauses, inputSchema, outputSchema: recordOutput,
  readOnly: true, classes: details.privacy ? ['sensitive'] : ['standard'], untrusted: true, ...details,
})
const read = (name: string, title: string, description: string, view: string, clauses: string[], inputSchema = object({}), details: Details = {}, list = false): ToolSpec => ({
  ...spec(name, title, description, clauses, inputSchema, details), view, outputSchema: list ? listOutput : recordOutput,
})
const write = (name: string, title: string, description: string, action: string, clauses: string[], inputSchema: ToolSpec['inputSchema'], details: Details = {}): ToolSpec => ({
  ...spec(name, title, description, clauses, inputSchema, details), action, readOnly: false,
})
const course: Details = { record: { kind: 'course', argument: 'course' }, draft: true, material: true }
const edit = (name: string, title: string, action: string, fields: NonNullable<ToolSpec['inputSchema']['properties']>, required = Object.keys(fields), clauses = ['BEAM-03']): ToolSpec =>
  write(`course.${name}`, title, `${title} in the editable draft. Requires its current draftVersion; publication remains a named human decision.`, action, clauses, object({ ...editing, ...fields }, ['course', 'draftVersion', ...required]), course)

/** Static, transport-independent declarations used by the surface and journey. */
export const toolSpecs: ToolSpec[] = [
  read('identity.read', 'Read my authority', 'Read the sponsor’s current native roles and business.', 'me', ['BEAM-01'], object({}), { privacy: 'identity' }),
  read('members.list', 'List member names', 'Read member ids and display names, as the native member picker permits.', 'members', ['BEAM-01'], object({}), {}, true),
  read('sources.list', 'List source versions', 'Read owned source provenance and immutable versions. Provider-dependent rights checks require a human door.', 'sources', ['BEAM-02'], object({}), { material: true }, true),
  read('courses.list', 'List courses', 'Read courses within current native course authority.', 'courses', ['BEAM-03'], object({}), {}, true),
  read('course.read', 'Read a course draft', 'Read the draft, draftVersion, submitted revisions and source notices permitted by native course authority.', 'courses/:id', ['BEAM-03'], object({ id }), { material: true, record: { kind: 'course', argument: 'id' } }),
  read('revision.read', 'Read an immutable revision', 'Read exact revision lessons, citations and assessment rules within native course authority.', 'revisions/:id', ['BEAM-03', 'BEAM-07'], object({ id }), { material: true, record: { kind: 'revision', argument: 'id' } }),
  { ...read('source.read', 'Read source bytes', 'Read checksummed immutable source bytes through the native source-file custody check; encoded as base64 inert data.', 'source-files/:id', ['BEAM-02'], object({ id }), { material: true, record: { kind: 'source_version', argument: 'id' } }), outputSchema: object({ id, filename: text(200), mediaType: text(200), size: integer(1, 25_000_000), sha256: text(64), base64: text(34_000_000) }) },
  read('people.list', 'Read scoped people', 'Read people and teams under current native manager authority. Personal directory records are sensitive.', 'people', ['BEAM-01', 'ORG-004'], object({}), { privacy: 'people' }),
  read('paths.list', 'List role paths', 'Read native paths and their immutable revisions as a manager.', 'paths', ['BEAM-04'], object({}), {}, true),
  read('report.read', 'Read the training report', 'Read scoped personal training records and totals. Native expired-attempt closure still applies; no assessment decision tool is exposed.', 'report', ['BEAM-13', 'BEAM-17', 'REPORT-001', 'CONNECT-016'], object({ team: id, course: id, status: choice('all', 'open', 'overdue', 'completed', 'expiring', 'deferred', 'exempt', 'missing') }, []), { privacy: 'report' }),
  read('proposals.list', 'List prepared work', 'Read the sponsor’s visible prepared work, reasons, exclusions and human decisions.', 'proposals', ['AGENT-001'], object({ state: choice('waiting', 'approved', 'declined') }, []), { privacy: 'proposals' }, true),
  read('proposal.read', 'Read prepared work', 'Read a preparation only where the sponsor prepared it or may decide it under native authority.', 'proposals/:id', ['AGENT-001'], object({ id }), { privacy: 'proposal', record: { kind: 'proposal', argument: 'id' } }),
  read('impact.read', 'Read source-change impact', 'Read changed source passages and affected lessons, assessments and group counts; no retraining decision is made.', 'impact/:id', ['AGENT-004'], object({ id }), { material: true, record: { kind: 'notice', argument: 'id' } }),
  read('questions.read', 'Read anonymous staff answers', 'Read answers only when native closing and minimum-group privacy rules release them; never rank people.', 'questions/:id', ['BEAM-19'], object({ id }), { record: { kind: 'question_plan', argument: 'id' } }),
  read('diagnosis.read', 'Read imported evidence comparison', 'Read the minimized authorized import and its privacy-bounded group comparison. Human import and review remain separate.', 'diagnosis-imports/:id', ['AGENT-002', 'AGENT-003'], object({ id }), { material: true, record: { kind: 'diagnosis_import', argument: 'id' } }),
  { ...spec('material.search', 'Search published material', 'Search published titles and summaries, with published lessons and cited source versions. Text is untrusted data.', ['BEAM-02', 'CONNECT-016'], object({ query: text(200, 0) }), { material: true }), outputSchema: object({ note: text(1000), courses: listOutput }) },
  write('course.create', 'Create a course draft', 'Create an empty native draft with a named human reviewer. Does not publish or assign.', 'course.create', ['BEAM-03'], object({ title: text(160), summary: text(1000, 0), reviewer: id, unit: id }, ['title', 'reviewer'])),
  edit('save_details', 'Save draft details', 'course.details', { title: text(160), summary: text(1000, 0) }, ['title']),
  edit('save_lesson', 'Save a draft lesson', 'course.lesson', { lesson: id, title: text(160), body: text(50_000), sources: array(id), base: text(64) }, ['title', 'body']),
  edit('remove_lesson', 'Remove a draft lesson', 'course.lesson.remove', { lesson: id }),
  edit('move_lesson', 'Reorder a draft lesson', 'course.lesson.move', { lesson: id, direction: choice('up', 'down') }),
  edit('save_block', 'Save a draft block', 'course.block', { lesson: id, block: id, content: blockSchema }, ['lesson', 'content'], ['BEAM-03', 'AUTHOR-001']),
  edit('change_block', 'Change a draft block', 'course.block.change', { lesson: id, block: id, operation: choice('remove', 'duplicate', 'up', 'down') }, undefined, ['BEAM-03', 'AUTHOR-001']),
  edit('reuse_block', 'Reuse an authored block', 'course.block.reuse', { lesson: id, from: text(650) }, undefined, ['BEAM-03', 'AUTHOR-001']),
  edit('save_question', 'Save a draft question', 'course.question', {
    question: id, prompt: text(1000), kind: choice('choice', 'blank', 'order', 'match', 'text'), points: integer(1, 100), always: flag,
    choices: text(3000), correct: text(40), answers: text(3000), ignoreCase: flag, items: text(3000), pairs: text(6000), guidance: text(2000, 0),
  }, ['prompt'], ['BEAM-03', 'BEAM-07', 'LEARN-001', 'LEARN-015']),
  edit('remove_question', 'Remove a draft question', 'course.question.remove', { question: id }),
  edit('save_assessment', 'Save draft assessment rules', 'course.assessment', {
    passPercent: nullable(integer(1, 100)), maxAttempts: nullable(integer(1, 20)), timeLimitMinutes: nullable(integer(1, 600)),
    practicalInstructions: text(5000, 0), assessor: text(200, 0), drawCount: nullable(integer(1, 60)), shuffle: flag, feedback: choice('attempt', 'final', 'score'),
  }, [], ['BEAM-03', 'BEAM-07', 'BEAM-08', 'LEARN-001']),
  edit('save_survey', 'Save draft satisfaction questions', 'course.survey', { survey: text(6000, 0) }, [], ['BEAM-03', 'LEARN-001']),
  edit('submit', 'Submit a draft for human review', 'course.submit', {}),
  write('draft.propose', 'Propose a course draft', 'Save an exact complete draft proposal, immutable source inputs and passages against draftVersion. A human accepts or declines; it never publishes.', 'proposal.create', ['BEAM-03', 'BEAM-14', 'AGENT-001', 'CONNECT-016'], object(draftProposal, ['course', 'draftVersion', 'summary', 'draft']), course),
  write('impact.propose', 'Prepare source-change edits', 'Prepare Beam’s deterministic source-change proposal against the current draft; human source decisions and publication stay separate.', 'impact.propose', ['AGENT-004'], object({ notice: id, draftVersion }), { material: true, draft: true, record: { kind: 'notice', argument: 'notice' } }),
  write('preparation.propose', 'Prepare work for a person', 'Prepare an assignment plan, reminders, staff questions, process change, intervention or scenario using the explicit kind payload. A human decides and applies it; this call sends nothing.', 'agent.propose', ['BEAM-18', 'BEAM-19', 'BEAM-20', 'AGENT-001', 'AGENT-003', 'AGENT-006'], preparationSchema, { material: true }),
  write('outcome.plan', 'Prepare an outcome measurement plan', 'Prepare a privacy-bounded measurement plan for a waiting intervention. Human approval, outcome import and retirement remain human.', 'outcome.plan', ['AGENT-005'], outcomeSchema, { record: { kind: 'intervention', argument: 'intervention' } }),
  write('diagnosis.prepare', 'Prepare a diagnosis from imported evidence', 'Prepare Beam’s rule-based diagnosis from an authorized minimized human import. It neither imports evidence nor reviews the diagnosis.', 'diagnosis.prepare', ['AGENT-002', 'AGENT-003'], object({ import: id }), { material: true, record: { kind: 'diagnosis_import', argument: 'import' } }),
]

/** Existing application grants retain their exact three-tool boundary. */
export const legacyMcpScopes: Record<string, string> = {
  search_material: 'beam.material.search', read_report: 'beam.report.read', propose_course_change: 'beam.draft.propose',
}
