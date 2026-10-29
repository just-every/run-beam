import type { Bindings } from '../../auth.server.ts'
import { ToolRefusal, type ToolContext, type ToolDefinition } from '../../modules/agent-door/index.ts'
import { BeamError } from '../core.ts'
import { actorFor } from './actor.ts'
import { nativeFacts } from './tool-facts.ts'
import { admitNative, runNative } from './tool-native.ts'
import { nativeRecord, nativeSummary, nativeTargetFor } from './tool-records.ts'
import { toolSpecs } from './tool-specs.ts'

export { toolSpecs, legacyMcpScopes } from './tool-specs.ts'

async function refusal<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof BeamError) {
      const details = error.detail && typeof error.detail === 'object' && !Array.isArray(error.detail) ? error.detail as Record<string, unknown> : {}
      throw new ToolRefusal(error.code, error.code, details)
    }
    throw error
  }
}

/** The shared door supplies policy, pause, named approval, replay and audit.
 * Native Beam services remain the sole authority and mutation chokepoints. */
export function createTools(env: Bindings): ToolDefinition[] {
  return toolSpecs.map(spec => {
    const { action: _action, view: _view, record: _record, material: _material, privacy: _privacy, draft: _draft, ...metadata } = spec
    const authorized = async (args: Record<string, unknown>, ctx: ToolContext) => {
      const actor = await actorFor(env, ctx, spec.name)
      await admitNative(env, spec, args, actor)
      return actor
    }
    return {
      ...metadata,
      classify: (args, ctx) => refusal(async () => nativeFacts(env, spec, args, await authorized(args, ctx))),
      target: (args, ctx) => refusal(async () => nativeTargetFor(env, spec, args, await authorized(args, ctx))),
      ...(!spec.readOnly ? { summary: (args: Record<string, unknown>, ctx: ToolContext) => refusal(async () => nativeSummary(env, spec, args, await authorized(args, ctx))) } : {}),
      ...(spec.draft ? {
        revisionType: 'integer' as const,
        revision: (args: Record<string, unknown>, ctx: ToolContext) => refusal(async () => (await nativeRecord(env, spec, args, await authorized(args, ctx)))?.revision ?? null),
      } : {}),
      run: (args, ctx) => refusal(async () => {
        const actor = await authorized(args, ctx)
        return { result: await runNative(env, spec, args, actor, ctx) }
      }),
    }
  })
}
