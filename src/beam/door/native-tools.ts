import { type Bindings } from '../../auth.server.ts'
import { ToolRefusal, type ToolContext, type ToolDefinition, type JsonSchemaObject } from '../../modules/agent-door/index.ts'
import { actions } from '../actions.ts'
import { requireAgentScope } from '../agent-credentials.ts'
import { requireCourseRole } from '../units.ts'
import { Input } from '../input.ts'
import { one } from '../core.ts'
import { callActor, native } from './people.ts'
import definitions from './actions.json'

export function preparationTools(env: Bindings): ToolDefinition[] {
  return definitions.map(definition => {
    const { action, ...declaration } = definition
    const courseId = async (args: Record<string, unknown>) => args.course ? String(args.course) : action === 'impact.propose'
      ? (await one<{ course_id: string }>(env, 'SELECT course_id FROM beam_source_notices WHERE id=?', String(args.notice)))?.course_id : undefined
    const prepare = async (args: Record<string, unknown>, ctx: ToolContext) => {
      const actor = await callActor(env, ctx)
      requireAgentScope(actor, action, 'POST')
      if (actor.app) throw new ToolRefusal('application_scope_forbidden')
      const course = await courseId(args)
      if (course) await requireCourseRole(env, actor, course, 'author')
      return actor
    }
    return { ...declaration, classes: declaration.classes as ToolDefinition['classes'], inputSchema: declaration.inputSchema as unknown as JsonSchemaObject, untrusted: true,
      outputSchema: action === 'course.lesson' ? { type: 'object', properties: { id: { type: 'string' }, conflict: { type: 'string' }, draftVersion: { type: 'integer' } }, anyOf: [{ required: ['id'] }, { required: ['conflict'] }] } : declaration.outputSchema,
      title: action, description: `Run Beam's native ${action} preparation. Current role and course grants apply. Publication, decisions and administration retain their native person doors.`,
      classify: (args, ctx) => native(async () => {
        await prepare(args, ctx)
        return [{ class: action === 'course.block.change' ? args.operation === 'remove' ? 'destructive' : 'standard' : declaration.classes[0] as 'standard' | 'destructive', facts: { measure: 1 } }]
      }),
      revision: 'draftVersion' in declaration.inputSchema.properties ? (args, ctx) => native(async () => {
        await prepare(args, ctx)
        return (await one<{ version: number }>(env, 'SELECT draft_version AS version FROM beam_courses WHERE id=?', await courseId(args) ?? ''))?.version ?? null
      }) : undefined,
      summary: (args, ctx) => native(async () => {
        await prepare(args, ctx)
        const course = await courseId(args)
        const target = course ? await one(env, 'SELECT id,title AS name,draft_json FROM beam_courses WHERE id=?', course) : null
        const draft = target ? JSON.parse(target.draft_json) : null
        const lesson = draft?.lessons.find((item: { id: unknown }) => item.id === args.lesson)
        const question = draft?.questions.find((item: { id: unknown }) => item.id === args.question)
        return { target: target ? { id: target.id, name: target.name } : { id: String(args.notice ?? args.intervention ?? args.import ?? ctx.person.id), name: String(args.title ?? action) }, items: [String(lesson?.title ?? question?.prompt ?? args.summary ?? args.kind ?? action)] }
      }),
      run: (args, ctx) => native(async () => {
        const actor = await prepare(args, ctx)
        const source = args.from as { course?: string; lesson?: string; block?: string } | undefined
        const values = { ...args, ...(action === 'course.block.reuse' ? { from: `${source?.course}:${source?.lesson}:${source?.block}` } : {}), agent: ctx.actor.label }
        const result = await actions[action](env, actor, Input.of(values), new Request(`${env.AUTH_ORIGIN}/api/beam/${action}`, { method: 'POST' }))
        const saved = result as { id?: string; conflict?: string }
        const id = saved.id ?? saved.conflict!
        ctx.emit(action === 'course.submit' ? 'revision.prepared' : 'preparation.changed', `beam://preparations/${encodeURIComponent(id)}`, { action })
        return { result, ...(!actor.app && args.course ? { resources: [{ uri: `beam://courses/${encodeURIComponent(String(args.course))}`, name: 'Course draft' }] } : action === 'agent.propose' ? { resources: [{ uri: `beam://proposals/${encodeURIComponent(id)}`, name: 'Prepared native work' }] } : {}) }
      }),
    }
  })
}
