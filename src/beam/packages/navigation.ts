import { insist } from '../core'
import type { PackageManifest } from './types'

/** Resolve only navigation the manifest admits. Launch rechecks prerequisites and assignment access. */
export function navigationTarget(manifest: PackageManifest, current: string, request: string) {
  if (!request || request === '_none_') return null
  if (['exit', 'exitAll', 'abandon', 'abandonAll', 'suspendAll'].includes(request)) return { exit: true }
  const position = manifest.scos.findIndex(sco => sco.id === current)
  if (request === 'continue' || request === 'previous') {
    insist(manifest.sequencing?.flow && (request !== 'previous' || !manifest.sequencing.forwardOnly), 'package_navigation_not_available', 409)
    const next = manifest.scos[position + (request === 'continue' ? 1 : -1)]
    insist(next, 'package_navigation_not_available', 409)
    return { sco: next.id }
  }
  const choice = request.match(/^\{target=([^{}]+)\}(choice|jump)$/)
  insist(choice && manifest.sequencing?.choice && manifest.scos.some(sco => sco.id === choice[1]), 'package_navigation_not_available', 409)
  return { sco: choice[1] }
}
