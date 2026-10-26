// A provider may select originals, but cannot make a passage relevant by naming it.
// This is an additional conservative veto, not a replacement for its support judgment.
import type { Row } from './core'
const noise = new Set(`a an and are as at be been by can could did do does for from had has have how i if in is it me my of on or our please should that the their them there these they this to us was were what when where which who why will with would you your according published lesson policy question`.split(' '))
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !noise.has(word)).map(word => word.length > 4 ? word.replace(/(?:ing|ed|s)$/, '') : word))]
export function supportedSelection(question: string, selected: Row[], available: Row[]) {
 const needed = terms(question)
 if (!needed.length) return false
 const selectedTerms = new Set(terms(selected.map(p => p.text).join(' ')))
 if (!needed.every(term => selectedTerms.has(term))) return false
 // Differing complete statements on the same question are ambiguous. Do not
 // silently pick one source's policy over another; send the question to an expert.
 const complete = available.filter(p => {
  const words = new Set(terms(p.text))
  return needed.every(term => words.has(term))
 })
 const originals = new Set(complete.map(p => p.text.toLowerCase().replace(/\s+/g, ' ').trim()))
 return originals.size <= 1
}
