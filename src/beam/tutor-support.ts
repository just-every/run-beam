// Semantic support belongs to the provider's structured judgment. These extra
// vetoes detect a disjoint selection, an omitted question part, or a directly
// opposed original; vocabulary differences alone are not evidence of refusal.
import type { Row } from './core'
const noise = new Set(`a an and are as at be been by can could did do does for from had has have how i if in is it me my of on or our please should that the their them there these they this to us was were what when where which who why will with would you your according published lesson policy question`.split(' '))
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !noise.has(word)).map(word => word.length > 4 ? word.replace(/(?:ing|ed|s)$/, '') : word))]
const statements = (text: string) => text.toLowerCase().split(/[.!?;\n]+/).map(value => ({
 negative: /\b(never|not|mustn't|cannot|can't)\b/.test(value),
 words: terms(value.replace(/\b(never|not|mustn't|cannot|can't)\b/g, '').replace(/\s+/g, ' ')).join(' '),
})).filter(value => value.words)
export function supportedSelection(question: string, selected: Row[], available: Row[]) {
 const chosen = new Set(terms(selected.map(p => p.text).join(' ')))
 const corpus = new Set(terms(available.map(p => p.text).join(' ')))
 const parts = question.split(/\band\b|[;?]+/i).filter(part => terms(part).length)
 for (const part of parts) {
  const words = terms(part)
  // A wholly paraphrased question is left to semantic judgment. Where the
  // corpus does contain the requested topic, selecting only disjoint text is
  // positive evidence of a mismatch. Each explicit conjunct must be covered.
  if (!words.some(word => chosen.has(word)) && (parts.length > 1 || words.some(word => corpus.has(word)))) return false
 }
 const selectedStatements = selected.flatMap(p => statements(p.text))
 return !available.flatMap(p => statements(p.text)).some(other => selectedStatements.some(value =>
  value.words === other.words && value.negative !== other.negative))
}
