// cmi5 Quartz CourseStructure.xsd. ZIP-hosted AUs only; unsupported features fail admission explicitly.
import { packagePath } from './archive'
import { parseXml, packageXml as x, valid, supported, type Element } from './manifest'
import type { PackageManifest } from './types'
const NS = 'https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd'
export const MOVE_ON = ['Passed', 'Completed', 'CompletedAndPassed', 'CompletedOrPassed', 'NotApplicable']
export function parseCmi5(bytes: Uint8Array, files: Set<string>): PackageManifest {
  const root = parseXml(bytes), k = (name: string) => x.key(NS, name), a = (name: string) => x.key('', name)
  valid(root.name === 'courseStructure' && root.ns === NS, 'cmi5 courseStructure namespace')
  x.shape(root, ['course', 'au', 'block'].map(k))
  const ids = new Set<string>()
  function identity(node: Element) {
    const id = x.attr(node, 'id') ?? ''
    valid(/^[a-z][a-z0-9+.-]*:[^\s\x00-\x1f]+$/i.test(id) && id.length <= 2048 && !ids.has(id), 'cmi5 unique absolute activity IRI')
    ids.add(id); return id
  }
  function language(node: Element, name: string) {
    const container = x.child(node, name)
    valid(container, `cmi5 ${name} required`); x.shape(container!, [k('langstring')])
    const values = x.children(container!, 'langstring')
    valid(values.length > 0, `cmi5 ${name} language`)
    const seen = new Set<string>()
    for (const value of values) { x.shape(value, [], [a('lang')], true); const lang = x.attr(value, 'lang') ?? ''; valid(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(lang) && !seen.has(lang.toLowerCase()), 'cmi5 language'); seen.add(lang.toLowerCase()) }
    const text = x.text(values.find(v => /^en(?:-|$)/i.test(x.attr(v, 'lang') ?? '')) ?? values[0])
    valid(text.length > 0 && text.length <= (name === 'title' ? 500 : 10000), `cmi5 ${name} length`)
    return text
  }
  const course = x.child(root, 'course'); valid(course && x.elements(root)[0] === course, 'cmi5 course first')
  x.shape(course!, ['title', 'description'].map(k), [a('id')])
  const result: PackageManifest = { standard: 'cmi5', courseIri: identity(course!), title: language(course!, 'title'), objectives: [language(course!, 'description')], scos: [] }
  function visit(node: Element) {
    if (node.name === 'block') {
      x.shape(node, ['title', 'description', 'au', 'block'].map(k), [a('id')])
      // Block satisfaction is a separate standard obligation; do not silently flatten it.
      supported(false, 'cmi5 nested blocks (use a flat AU course)')
    }
    x.shape(node, ['title', 'description', 'url', 'launchParameters'].map(k), ['id', 'moveOn', 'masteryScore', 'launchMethod', 'activityType'].map(a))
    const id = identity(node), moveOn = x.attr(node, 'moveOn') ?? 'NotApplicable', method = x.attr(node, 'launchMethod') ?? 'AnyWindow'
    valid(MOVE_ON.includes(moveOn), 'cmi5 moveOn'); valid(['AnyWindow', 'OwnWindow'].includes(method), 'cmi5 launchMethod')
    supported(method === 'AnyWindow', 'cmi5 OwnWindow (isolated embedded AUs only)')
    const url = x.scalar(x.child(node, 'url')), path = packagePath(url, node.base, true)
    valid(files.has(path) && /\.html?$/i.test(path), `missing cmi5 launch asset ${path}`)
    const score = x.attr(node, 'masteryScore'); valid(score === undefined || /^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/.test(score), 'cmi5 masteryScore')
    const parameters = x.scalar(x.child(node, 'launchParameters')); valid(parameters.length <= 4000, 'cmi5 launchParameters limit')
    result.scos.push({ id, title: language(node, 'title'), objectives: [language(node, 'description')], launch: path, prerequisites: [], masteryScore: score === undefined ? null : Number(score), moveOn, launchParameters: parameters, activityType: x.attr(node, 'activityType') })
  }
  for (const node of x.elements(root).filter(node => node !== course)) visit(node)
  valid(result.scos.length > 0 && result.scos.length <= 200, 'cmi5 AU count (1–200)')
  return result
}
