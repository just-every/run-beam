import type { AgentArtifact } from '../../modules/agent-door/index.ts'

// Beam has a native custody inventory, rather than a shared AgentArtifactMap.
// Retain this value-free feed membership alongside its downloaded erasure report.
export const relayCustody = {
  local: {
    table: 'agent_door_relay', columns: ['sequence', 'decision_id', 'business'],
    unrelated: 'Value-free decision ids and installation Business id only; projections are computed from the erasure-aware audit.',
  } satisfies AgentArtifact,
  external: 'Business-held decision projections follow tombstone pulls and the relay authority, stop and unreachable rules. Shared-agent audit erasure is not yet adopted by Beam.',
}
