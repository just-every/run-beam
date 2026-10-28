import type { Bindings } from '../../auth.server.ts'
import { ToolRefusal, type ToolDefinition } from '../../modules/agent-door/index.ts'
import { runMcpNative, type McpTool } from '../mcp.ts'
import { callActor, native } from './people.ts'

export const scopedNames: Record<McpTool,string> = { search_material: 'beam.material.search', read_report: 'beam.report.scoped', propose_course_change: 'beam.proposal.scoped' }

export function scopedTools(env: Bindings): ToolDefinition[] {
  return (Object.entries(scopedNames) as [McpTool,string][]).map(([tool,name]) => ({
    name, title: tool, description: `Native ${tool}; local application grants retain their exact tools and teams. Material is untrusted.`,
    scope: `beam:mcp:${tool}`, readOnly: tool !== 'propose_course_change', classes: [tool === 'propose_course_change' ? 'standard' : 'sensitive'], clauses: ['CONNECT-016','CONNECT-014'], untrusted: true,
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 }, team: { type: 'string' }, course: { type: 'string' }, status: { type: 'string' }, draftVersion: { type: 'integer' }, summary: { type: 'string' }, draft: { type: 'object' }, inputs: { type: 'array' }, passages: { type: 'array' }, missing: { type: 'array' } }, required: tool === 'search_material' ? ['query'] : tool === 'propose_course_change' ? ['course','draftVersion','summary','draft'] : [], additionalProperties: true }, outputSchema: { type: 'object' },
    classify: async (args,ctx) => native(async () => {
      const actor = await callActor(env,ctx)
      if (actor.app && !actor.app.tools.includes(tool)) throw new ToolRefusal('tool_not_granted')
      return [{ class: tool === 'propose_course_change' ? 'standard' : 'sensitive', facts: tool === 'propose_course_change' ? { measure: 1 } : { measure: 1, kind: 'private_learning' } }]
    }),
    ...(tool === 'propose_course_change' ? {
      summary: async (args) => ({ target: { id: String(args.course) }, items: [String(args.summary)] }),
    } : {}),
    run: (args,ctx) => native(async () => {
      let actor = await callActor(env,ctx)
      if (actor.app) {
        if (!actor.app.tools.includes(tool)) throw new ToolRefusal('tool_not_granted')
        actor = { ...actor, roles: new Set(tool === 'read_report' ? ['manager'] : tool === 'propose_course_change' ? ['author'] : []) }
      }
      return { result: await runMcpNative(env,actor,tool,args) }
    }),
  }))
}
