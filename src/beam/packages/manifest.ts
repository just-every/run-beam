import { parseCmi5 } from './cmi5-manifest'
import { insist } from '../core'
import { packagePath, unpackPackage } from './archive'
import type { PackageFile, PackageManifest, PackageSco, PackageStandard } from './types'
export type { PackageManifest, PackageSco, PackageStandard } from './types'

const CP = new Set(['http://www.imsproject.org/xsd/imscp_rootv1p1p2', 'http://www.imsglobal.org/xsd/imscp_v1p1'])
const ADL12 = 'http://www.adlnet.org/xsd/adlcp_rootv1p2', ADL04 = 'http://www.adlnet.org/xsd/adlcp_v1p3'
const ADLSEQ = 'http://www.adlnet.org/xsd/adlseq_v1p3'
const SEQ = 'http://www.imsglobal.org/xsd/imsss', XML = 'http://www.w3.org/XML/1998/namespace'
export interface Element { name: string; ns: string; attrs: Record<string, string>; children: (Element | string)[]; base: string }
const elements = (node: Element) => node.children.filter((child): child is Element => typeof child !== 'string')
const text = (node: Element | undefined): string => node ? node.children.map(child => typeof child === 'string' ? child : text(child)).join('').trim() : ''
export function valid(condition: unknown, feature: string): asserts condition { insist(condition, 'package_invalid_manifest', 422, { feature }) }
export function supported(condition: unknown, feature: string): asserts condition { insist(condition, 'package_unsupported_feature', 422, { feature }) }
const key = (ns: string, name: string) => `{${ns}}${name}`
const attr = (node: Element, name: string, ns = '') => node.attrs[key(ns, name)]
const children = (node: Element, name: string, ns = node.ns) => elements(node).filter(child => child.name === name && child.ns === ns)
function child(node: Element, name: string, ns = node.ns) {
  const matches = children(node, name, ns)
  valid(matches.length <= 1, `duplicate ${name}`)
  return matches[0]
}
const identifier = (value: string | undefined, feature: string) => { valid(value && value.length <= 256 && !/[\s\x00-\x1f]/.test(value), feature); return value! }
const boolean = (value: string | undefined, fallback: boolean) => { valid(value === undefined || /^(?:true|false|0|1)$/.test(value), 'invalid boolean'); return value === undefined ? fallback : value === 'true' || value === '1' }
function number(value: string, min: number, max: number, feature: string) {
  valid(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number(value) >= min && Number(value) <= max, feature)
  return Number(value)
}
function shape(node: Element, allowedChildren: string[], allowedAttrs: string[] = [], allowText = false) {
  valid(allowText || node.children.every(item => typeof item !== 'string' || !item.trim()), `${node.name} unexpected text`)
  for (const item of elements(node)) supported(allowedChildren.includes(key(item.ns, item.name)), `${node.name}/${item.name} (${item.ns})`)
  for (const name of Object.keys(node.attrs)) supported(allowedAttrs.includes(name) || name === key(XML, 'base') || name === key('http://www.w3.org/2001/XMLSchema-instance', 'schemaLocation'), `${node.name} attribute ${name}`)
}
function scalar(node: Element | undefined) {
  if (!node) return ''
  shape(node, [], [key(XML, 'lang')], true)
  return text(node)
}

function decode(value: string) {
  valid(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(value), 'XML entity')
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[entity]) return named[entity]
    const point = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    valid(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && point !== 0xfffe && point !== 0xffff, 'XML character')
    return String.fromCodePoint(point)
  })
}

/** No DTD, entity expansion, external retrieval, schema fetch or executable markup. */
export function parseXml(bytes: Uint8Array): Element {
  valid(bytes.length > 0 && bytes.length <= 2_000_000, 'manifest size (2 MB maximum)')
  let source: string
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { valid(false, 'manifest must be UTF-8'); throw new Error('unreachable') }
  valid(!/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(source), 'XML character')
  const root: Element = { name: '', ns: '', attrs: {}, children: [], base: '' }
  const stack = [{ node: root, qualified: '', ns: Object.assign(Object.create(null), { xml: XML }) as Record<string, string> }]
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?(?:\s+[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>|[^<]+/gy
  let at = 0, count = 0
  while (at < source.length) {
    token.lastIndex = at
    const match = token.exec(source)
    valid(match && match.index === at && ++count <= 50_000, 'malformed XML or node limit')
    const value = match![0], current = stack.at(-1)!
    at = token.lastIndex
    if (value.startsWith('<!--')) { valid(!value.slice(4, -3).includes('--'), 'XML comment'); continue }
    if (value.startsWith('<?')) { valid(at === value.length && /^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?(?:\s+standalone=["'](?:yes|no)["'])?\s*\?>$/i.test(value), 'XML processing instruction'); continue }
    if (value.startsWith('<![CDATA[')) { valid(stack.length > 1, 'CDATA outside root'); current.node.children.push(value.slice(9, -3)); continue }
    if (!value.startsWith('<')) { valid(!value.includes(']]>'), 'XML text'); current.node.children.push(decode(value)); continue }
    const qualified = value.match(/^<\/?([^\s/>]+)/)![1]
    if (value.startsWith('</')) {
      valid(/^<\/[^\s/>]+\s*>$/.test(value) && stack.length > 1 && current.qualified === qualified, 'XML closing tag')
      stack.pop(); continue
    }
    const raw = Object.create(null) as Record<string, string>, ns = Object.assign(Object.create(null), current.ns) as Record<string, string>
    for (const item of value.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      valid(!(item[1] in raw), 'duplicate XML attribute')
      raw[item[1]] = decode(item[2] ?? item[3])
      if (item[1] === 'xmlns') ns[''] = raw[item[1]]
      else if (item[1].startsWith('xmlns:')) { valid(item[1] !== 'xmlns:xmlns' && (item[1] !== 'xmlns:xml' || raw[item[1]] === XML) && !!raw[item[1]], 'XML namespace'); ns[item[1].slice(6)] = raw[item[1]] }
    }
    const resolve = (name: string, attribute = false) => {
      const parts = name.split(':')
      valid(parts.length === 1 || !!ns[parts[0]], 'unbound XML namespace')
      return { name: parts.at(-1)!, ns: parts.length === 2 ? ns[parts[0]] : attribute ? '' : ns[''] ?? '' }
    }
    const resolved = resolve(qualified), attrs = Object.create(null) as Record<string, string>
    for (const [name, content] of Object.entries(raw)) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) continue
      const attribute = resolve(name, true), expanded = key(attribute.ns, attribute.name)
      valid(!(expanded in attrs), 'duplicate expanded XML attribute'); attrs[expanded] = content
    }
    let base = current.node.base
    const ownBase = attrs[key(XML, 'base')]
    if (ownBase) { supported(ownBase.endsWith('/') || ownBase === '.', 'xml:base must be a directory'); base = ownBase === '.' ? base : packagePath(ownBase, base, true) + '/' }
    const node: Element = { ...resolved, attrs, children: [], base }
    current.node.children.push(node)
    if (!value.endsWith('/>')) stack.push({ node, qualified, ns })
    valid(stack.length <= 48, 'XML nesting limit')
  }
  valid(stack.length === 1 && elements(root).length === 1 && root.children.every(item => typeof item !== 'string' || !item.trim()), 'XML root')
  return elements(root)[0]
}

function metadata(node: Element, cp: string): string[] {
  const result: string[] = [], meta = child(node, 'metadata', cp)
  if (!meta) return result
  const visit = (item: Element) => {
    supported(item.name !== 'location' || item.ns !== ADL12 && item.ns !== ADL04, 'external metadata location')
    if (/^(?:objective|learningObjective|description)$/.test(item.name)) {
      const value = text(item)
      if (value) { valid(value.length <= 10_000, 'metadata text limit'); result.push(value) }
    } else for (const nested of elements(item)) visit(nested)
  }
  visit(meta)
  return [...new Set(result)]
}

interface ObjectiveMap { owner: string; id: string; target: string; write: boolean; read: boolean }
interface PendingRule { sco: PackageSco; objective: string }

function sequencing(node: Element, sco: PackageSco | undefined, maps: ObjectiveMap[], rules: PendingRule[]) {
  shape(node, ['controlMode', 'objectives', 'sequencingRules'].map(name => key(SEQ, name)))
  const mode = child(node, 'controlMode', SEQ)
  const controls = { choice: true, flow: false, forwardOnly: false }
  if (mode) {
    shape(mode, [], ['choice', 'choiceExit', 'flow', 'forwardOnly', 'useCurrentAttemptObjectiveInfo', 'useCurrentAttemptProgressInfo'].map(name => key('', name)))
    for (const name of ['choice', 'flow', 'forwardOnly'] as const) controls[name] = boolean(attr(mode, name), controls[name])
    for (const name of ['choiceExit', 'useCurrentAttemptObjectiveInfo', 'useCurrentAttemptProgressInfo']) supported(boolean(attr(mode, name), true), `${name}=false`)
    supported(!sco, 'leaf controlMode')
  }
  const objectives = child(node, 'objectives', SEQ)
  if (objectives) {
    supported(!!sco, 'organization objectives and rollup')
    shape(objectives, ['primaryObjective', 'objective'].map(name => key(SEQ, name)))
    const seen = new Set<string>()
    valid(children(objectives, 'primaryObjective', SEQ).length === 1, 'sequencing primaryObjective')
    for (const objective of elements(objectives)) {
      shape(objective, ['minNormalizedMeasure', 'mapInfo'].map(name => key(SEQ, name)), ['objectiveID', 'satisfiedByMeasure'].map(name => key('', name)))
      const declared = attr(objective, 'objectiveID')
      const id = objective.name === 'primaryObjective' && declared === undefined ? `${sco!.id}.primary` : identifier(declared, 'objectiveID')
      valid(!seen.has(id), 'duplicate objectiveID'); seen.add(id)
      if (declared !== undefined) { sco!.objectiveIds!.push(id); sco!.objectives.push(id) }
      const measured = boolean(attr(objective, 'satisfiedByMeasure'), false), minimum = child(objective, 'minNormalizedMeasure', SEQ)
      supported(measured || !minimum, 'initialization-only minimum normalized measure with satisfiedByMeasure=false')
      if (minimum) shape(minimum, [], [], true)
      const measure = minimum ? number(text(minimum), -1, 1, 'minimum normalized measure') : 1
      if (objective.name === 'primaryObjective') { sco!.successThreshold = measured ? measure : null; if (declared !== undefined) sco!.primaryObjectiveId = id }
      else supported(!measured && !minimum, 'measured non-primary objective')
      const mapping = children(objective, 'mapInfo', SEQ)
      supported(mapping.length <= 1, 'multiple objective maps')
      for (const map of mapping) {
        shape(map, [], ['targetObjectiveID', 'readSatisfiedStatus', 'writeSatisfiedStatus', 'readNormalizedMeasure', 'writeNormalizedMeasure'].map(name => key('', name)))
        supported(!boolean(attr(map, 'writeNormalizedMeasure'), false) && !boolean(attr(map, 'readNormalizedMeasure'), true), 'global normalized measure mapping')
        const write = boolean(attr(map, 'writeSatisfiedStatus'), false), read = boolean(attr(map, 'readSatisfiedStatus'), true)
        supported(objective.name === 'primaryObjective' ? !read : !write, 'primary objective import or non-primary objective export')
        maps.push({ owner: sco!.id, id, target: identifier(attr(map, 'targetObjectiveID'), 'targetObjectiveID'), write, read })
      }
      supported(objective.name === 'primaryObjective' || mapping.length === 1, 'unmapped non-primary objective')
    }
  }
  const ruleSet = child(node, 'sequencingRules', SEQ)
  if (ruleSet) {
    supported(!!sco, 'organization sequencingRules')
    shape(ruleSet, [key(SEQ, 'preConditionRule')])
    for (const rule of elements(ruleSet)) {
      shape(rule, ['ruleConditions', 'ruleAction'].map(name => key(SEQ, name)))
      const conditions = child(rule, 'ruleConditions', SEQ), action = child(rule, 'ruleAction', SEQ)
      valid(conditions && action, 'sequencing rule conditions/action')
      shape(conditions!, [key(SEQ, 'ruleCondition')], [key('', 'conditionCombination')]); shape(action!, [], [key('', 'action')])
      supported(attr(action!, 'action') === 'disabled', `preCondition action ${attr(action!, 'action')}`)
      valid(['all', 'any'].includes(attr(conditions!, 'conditionCombination') ?? 'all'), 'conditionCombination')
      // OR of unsatisfied requirements is equivalent to AND of satisfied prerequisites.
      supported((attr(conditions!, 'conditionCombination') ?? 'all') === 'any' || elements(conditions!).length === 1, 'compound prerequisite conditions')
      valid(elements(conditions!).length > 0, 'empty ruleConditions')
      for (const condition of elements(conditions!)) {
        shape(condition, [], ['condition', 'operator', 'referencedObjective'].map(name => key('', name)))
        supported(attr(condition, 'condition') === 'satisfied' && attr(condition, 'operator') === 'not', 'rule condition (only not satisfied prerequisites supported)')
        rules.push({ sco: sco!, objective: identifier(attr(condition, 'referencedObjective'), 'referencedObjective') })
      }
    }
  }
  return controls
}

export function parsePackage(bytes: Uint8Array): { files: PackageFile[]; manifest: PackageManifest } {
  const files = unpackPackage(bytes), inventory = new Set(files.map(file => file.path)), source = files.find(file => file.path === 'imsmanifest.xml')
  const cmi5 = files.find(file => file.path === 'cmi5.xml')
  valid(!(source && cmi5), 'ambiguous SCORM and cmi5 manifests')
  if (cmi5) return { files, manifest: parseCmi5(cmi5.bytes, inventory) }
  valid(source, 'missing root imsmanifest.xml or cmi5.xml')
  const root = parseXml(source!.bytes), cp = root.ns
  valid(root.name === 'manifest' && CP.has(cp), 'SCORM manifest namespace')
  shape(root, ['metadata', 'organizations', 'resources'].map(name => key(cp, name)), ['identifier', 'version'].map(name => key('', name)))
  const declaredIds = new Set<string>()
  const declare = (value: string | undefined, feature: string) => { const id = identifier(value, feature); valid(!declaredIds.has(id), `duplicate identifier ${id}`); declaredIds.add(id); return id }
  declare(attr(root, 'identifier'), 'manifest identifier')
  const meta = child(root, 'metadata'), version = meta && scalar(child(meta, 'schemaversion'))
  const standards: Record<string, PackageStandard> = { '1.2': '1.2', '2004 2nd Edition': '2004-2', '2004 3rd Edition': '2004-3', '2004 4th Edition': '2004-4', 'CAM 1.3': '2004-2' }
  supported(version && Object.hasOwn(standards, version), `SCORM edition ${version || 'missing'}`)
  const standard = standards[version!], adl = standard === '1.2' ? ADL12 : ADL04
  valid(meta && /^(?:ADL SCORM|SCORM)$/i.test(scalar(child(meta, 'schema'))), 'SCORM metadata schema')
  const organizations = child(root, 'organizations'), resources = child(root, 'resources')
  valid(organizations && resources, 'organizations/resources required')
  shape(organizations!, [key(cp, 'organization')], [key('', 'default')]); shape(resources!, [key(cp, 'resource')])
  const orgs = children(organizations!, 'organization')
  supported(orgs.length === 1, 'multiple organizations')
  const org = orgs[0]
  valid(org && attr(org, 'identifier') && (!attr(organizations!, 'default') || attr(organizations!, 'default') === attr(org, 'identifier')), 'default organization')
  declare(attr(org, 'identifier'), 'organization identifier')
  shape(org, ['title', 'metadata', 'item'].map(name => key(cp, name)).concat(key(SEQ, 'sequencing')), ['identifier', 'structure'].map(name => key('', name)).concat(key(ADLSEQ, 'objectivesGlobalToSystem')))
  supported((attr(org, 'structure') ?? 'hierarchical') === 'hierarchical', 'organization structure')
  const objectivesGlobalToSystem = boolean(attr(org, 'objectivesGlobalToSystem', ADLSEQ), true)
  const manifest: PackageManifest = { standard, title: scalar(child(org, 'title')), objectives: metadata(root, cp).concat(metadata(org, cp)), scos: [] }
  valid(manifest.title.length > 0 && manifest.title.length <= 500, 'organization title')
  const launch = (node: Element, href: string, suffixAllowed = true) => {
    const split = href.search(/[?#]/), path = split < 0 ? href : href.slice(0, split), suffix = split < 0 ? '' : href.slice(split)
    valid(!/[\x00-\x1f\x7f]/.test(suffix) && (suffixAllowed || !suffix), 'asset URL query or fragment')
    const normalized = packagePath(path, node.base, true)
    valid(inventory.has(normalized), `missing asset ${normalized}`)
    return normalized + suffix
  }
  const resourceMap = new Map<string, { node: Element; launch?: string; type: string; dependencies: string[] }>()
  for (const resource of elements(resources!)) {
    shape(resource, ['metadata', 'file', 'dependency'].map(name => key(cp, name)), ['identifier', 'type', 'href'].map(name => key('', name)).concat(key(adl, standard === '1.2' ? 'scormtype' : 'scormType')))
    const id = declare(attr(resource, 'identifier'), 'resource identifier'), kind = attr(resource, standard === '1.2' ? 'scormtype' : 'scormType', adl) ?? 'asset'
    valid(!resourceMap.has(id), 'duplicate resource identifier')
    supported(attr(resource, 'type') === 'webcontent' && /^(?:sco|asset)$/.test(kind), 'resource type')
    const href = attr(resource, 'href'), dependencies: string[] = []
    for (const file of children(resource, 'file')) { shape(file, [key(cp, 'metadata')], [key('', 'href')]); launch(file, attr(file, 'href') ?? '', false) }
    for (const dependency of children(resource, 'dependency')) { shape(dependency, [], [key('', 'identifierref')]); dependencies.push(identifier(attr(dependency, 'identifierref'), 'dependency identifierref')) }
    resourceMap.set(id, { node: resource, type: kind, launch: href ? launch(resource, href) : undefined, dependencies })
  }
  for (const resource of resourceMap.values()) for (const dependency of resource.dependencies) valid(resourceMap.has(dependency), `missing dependency ${dependency}`)
  const ids = new Set<string>(), maps: ObjectiveMap[] = [], rules: PendingRule[] = []
  for (const item of children(org, 'item')) {
    shape(item, ['title', 'metadata'].map(name => key(cp, name)).concat((standard === '1.2' ? ['prerequisites', 'masteryscore', 'datafromlms'] : ['dataFromLMS', 'completionThreshold']).map(name => key(adl, name)), key(SEQ, 'sequencing')), ['identifier', 'identifierref', 'isvisible', 'parameters'].map(name => key('', name)))
    supported(boolean(attr(item, 'isvisible'), true), 'hidden organization item')
    const id = declare(attr(item, 'identifier'), 'item identifier'), resource = resourceMap.get(attr(item, 'identifierref') ?? '')
    valid(!ids.has(id), 'duplicate item identifier'); ids.add(id)
    supported(resource?.type === 'sco', 'non-SCO or nested organization item')
    valid(resource.launch, `missing SCO launch ${id}`)
    const parameters = attr(item, 'parameters') ?? ''
    supported(!parameters || !/[#\x00-\x1f\x7f]/.test(parameters), 'item parameters with fragment/control character')
    const launchUrl = resource.launch! + (parameters ? `${resource.launch!.includes('?') ? '&' : '?'}${parameters.replace(/^\?/, '')}` : '')
    supported(!parameters || !resource.launch!.includes('#'), 'parameters after launch fragment')
    const score = child(item, 'masteryscore', adl), prerequisite = child(item, 'prerequisites', adl)
    const sco: PackageSco = { id, title: scalar(child(item, 'title')), launch: launchUrl, prerequisites: [], masteryScore: score ? number(scalar(score), 0, 100, 'mastery score') : null, objectives: metadata(item, cp).concat(metadata(resource.node, cp)), objectiveIds: [], successThreshold: null, completionThreshold: null, required: true }
    valid(sco.title.length > 0 && sco.title.length <= 500, 'SCO title')
    if (prerequisite) {
      supported(standard === '1.2', '2004 adlcp prerequisites'); shape(prerequisite, [], [key('', 'type')], true)
      supported((attr(prerequisite, 'type') ?? 'aicc_script') === 'aicc_script' && /^[\w.:-]+(?:\s*&\s*[\w.:-]+)*$/.test(text(prerequisite)), 'prerequisite expression (only AND of item IDs supported)')
      sco.prerequisites = text(prerequisite).split(/\s*&\s*/)
    }
    if (score) supported(standard === '1.2', '2004 mastery score')
    const data = child(item, standard === '1.2' ? 'datafromlms' : 'dataFromLMS', adl)
    if (data) { sco.dataFromLMS = scalar(data); valid(sco.dataFromLMS.length <= 64000, 'launch data limit') }
    const threshold = child(item, 'completionThreshold', adl)
    if (threshold) {
      supported(standard !== '1.2', '1.2 completionThreshold')
      shape(threshold, [], ['completedByMeasure', 'minProgressMeasure', 'progressWeight'].map(name => key('', name)), true)
      if (attr(threshold, 'progressWeight') !== undefined) supported(number(attr(threshold, 'progressWeight')!, 0, 1, 'progress weight') === 1, 'completion progressWeight')
      if (attr(threshold, 'minProgressMeasure') !== undefined) number(attr(threshold, 'minProgressMeasure')!, 0, 1, 'completion threshold')
      if (text(threshold)) { supported(!Object.keys(threshold.attrs).length, 'mixed completion threshold formats'); sco.completionThreshold = number(text(threshold), 0, 1, 'completion threshold') }
      else {
        supported(boolean(attr(threshold, 'completedByMeasure'), false), 'initialization-only completionThreshold with completedByMeasure=false')
        sco.completionThreshold = number(attr(threshold, 'minProgressMeasure') ?? '1', 0, 1, 'completion threshold')
      }
    }
    const sequence = child(item, 'sequencing', SEQ)
    if (sequence) { supported(standard !== '1.2', 'SCORM 1.2 sequencing'); sequencing(sequence, sco, maps, rules) }
    manifest.scos.push(sco)
  }
  valid(manifest.scos.length > 0 && manifest.scos.length <= 200, 'SCO count (1–200)')
  const rootSequence = child(org, 'sequencing', SEQ)
  if (rootSequence) { supported(standard !== '1.2', 'SCORM 1.2 sequencing'); manifest.sequencing = sequencing(rootSequence, undefined, maps, rules) }
  else if (standard !== '1.2') manifest.sequencing = { choice: true, flow: false, forwardOnly: false }
  supported(manifest.scos.length === 1 || !manifest.sequencing || manifest.sequencing.choice || manifest.sequencing.flow, 'multi-SCO navigation with choice=false and flow=false')
  supported(maps.length === 0 || !objectivesGlobalToSystem, 'objectives global to installation (set adlseq:objectivesGlobalToSystem=false)')
  const writers = new Map<string, string>()
  for (const map of maps.filter(map => map.write)) { supported(!writers.has(map.target), 'multiple writers of global objective'); writers.set(map.target, map.owner) }
  for (const rule of rules) {
    const mapping = maps.find(map => map.owner === rule.sco.id && map.id === rule.objective && map.read), owner = mapping && writers.get(mapping.target)
    supported(owner, `unresolved prerequisite objective ${rule.objective}`)
    rule.sco.prerequisites.push(owner!)
  }
  for (const map of maps.filter(map => map.read)) supported(rules.some(rule => rule.sco.id === map.owner && rule.objective === map.id), 'objective imports outside prerequisite rules')
  for (const [index, sco] of manifest.scos.entries()) {
    sco.prerequisites = [...new Set(sco.prerequisites)]
    for (const prerequisite of sco.prerequisites) valid(manifest.scos.slice(0, index).some(previous => previous.id === prerequisite), `prerequisite must name an earlier SCO: ${prerequisite}`)
    sco.objectives = [...new Set(sco.objectives)]
    manifest.objectives.push(...sco.objectives)
  }
  manifest.objectives = [...new Set(manifest.objectives)]
  return { files, manifest }
}

export const packageXml = { elements, text, attr, children, child, shape, scalar, key, valid, supported }
