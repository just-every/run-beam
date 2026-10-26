// Semantic support belongs to the provider's structured judgment. These extra
// vetoes detect disjoint selections, missing aspect support, or a directly
// opposed original; vocabulary differences alone are not evidence of refusal.
import type { Row } from './core'
const noise = new Set(`a an and are as at be been by can could did do does for from had has have how i if in is it me my of on or our please should that the their them there these they this to us was were what when where which who why will with would you your according published lesson policy question`.split(' '))
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !noise.has(word)).map(word => word.length > 4 ? word.replace(/(?:ing|ed|s)$/, '') : word))]
const statements = (text: string) => text.toLowerCase().split(/[.!?;\n]+/).map(value => ({
 negative: /\b(never|not|mustn't|cannot|can't)\b/.test(value),
 words: terms(value.replace(/\b(never|not|mustn't|cannot|can't)\b/g, '').replace(/\s+/g, ' ')).join(' '),
})).filter(value => value.words)
export const questionParts = (question: string) => question.split(/\band\b|[;?]+/i).map(part => part.trim()).filter(part => terms(part).length)
export function supportedSelection(question: string, selected: Row[], available: Row[], support: Row[]) {
 const corpus = new Set(terms(available.map(p => p.text).join(' ')))
 const parts = questionParts(question)
 // Each supplied aspect needs its own explicit semantic judgment and selected
 // originals. An overall answered label cannot hide an omitted aspect.
 if (support.length !== parts.length || new Set(support.map(item => item.part)).size !== parts.length) return false
 for (const [index, part] of parts.entries()) {
  const evidence = support.find(item => item.part === index)
  if (!evidence || !evidence.passages.length || !evidence.passages.every((id: string) => selected.some(p => p.id === id))) return false
  const chosen = new Set(terms(selected.filter(p => evidence.passages.includes(p.id)).map(p => p.text).join(' ')))
  const words = terms(part)
  // A wholly paraphrased question is left to semantic judgment. Where the
  // corpus does contain the requested topic, selecting only disjoint text is
  // positive evidence of a mismatch. Absent vocabulary is not a veto;
  // the per-aspect semantic judgment covers ordinary paraphrases.
  if (!words.some(word => chosen.has(word)) && words.some(word => corpus.has(word))) return false
 }
 const selectedStatements = selected.flatMap(p => statements(p.text))
 return !available.flatMap(p => statements(p.text)).some(other => selectedStatements.some(value =>
  value.words === other.words && value.negative !== other.negative))
}
