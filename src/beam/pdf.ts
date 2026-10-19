// LEARN-002: a one-page, landscape, tagged PDF for a certificate. Assistive technology reads it in order: the document
// carries its language and title, every line of text is a structure element (a heading or a paragraph) linked to its
// marked content, and decoration is marked as an artifact. Text uses the standard Helvetica faces in WinAnsi encoding;
// a character WinAnsi lacks prints as "?".
export interface PdfLine { text: string; size: number; bold?: boolean; tag: 'H1' | 'H2' | 'P'; gapBefore?: number }

const WIN_ANSI: Record<string, number> = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '•': 0x95, '…': 0x85, '€': 0x80 }

/** A PDF literal string in WinAnsi, with escapes. */
function literal(text: string) {
  let out = ''
  for (const character of text) {
    const code = WIN_ANSI[character] ?? character.codePointAt(0)!
    const byte = code < 0x20 || (code > 0x7e && code < 0xa0 && !Object.values(WIN_ANSI).includes(code)) || code > 0xff ? 0x3f : code
    out += byte === 0x28 || byte === 0x29 || byte === 0x5c ? `\\${String.fromCharCode(byte)}` : byte > 0x7e ? `\\${byte.toString(8).padStart(3, '0')}` : String.fromCharCode(byte)
  }
  return `(${out})`
}

// Average Helvetica advance widths (per 1000 em), close enough to centre a line.
const width = (text: string, size: number, bold = false) => [...text].length * size * (bold ? 0.58 : 0.53)

export function certificatePdf(title: string, lines: PdfLine[], accent: string): Uint8Array<ArrayBuffer> {
  const W = 792, H = 612
  const [r, g, b] = [1, 3, 5].map(index => parseInt(accent.slice(index, index + 2), 16) / 255)
  let y = H - 96
  const parts: string[] = [`/Artifact BMC ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG 3 w 36 36 ${W - 72} ${H - 72} re S EMC`]
  lines.forEach((line, mcid) => {
    y -= (line.gapBefore ?? 0) + line.size * 1.35
    const x = Math.max(48, (W - width(line.text, line.size, line.bold)) / 2)
    parts.push(`/${line.tag} <</MCID ${mcid}>> BDC BT /${line.bold ? 'F2' : 'F1'} ${line.size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td ${literal(line.text)} Tj ET EMC`)
  })
  const content = parts.join('\n')
  const first = 10
  const elements = lines.map((line, mcid) => `<< /Type /StructElem /S /${line.tag} /P 8 0 R /Pg 3 0 R /K ${mcid} >>`)
  const refs = lines.map((_, index) => `${first + index} 0 R`).join(' ')
  const objects: Record<number, string> = {
    1: `<< /Type /Catalog /Pages 2 0 R /Lang (en-US) /MarkInfo << /Marked true >> /StructTreeRoot 6 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`,
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 7 0 R /StructParents 0 /Tabs /S >>`,
    4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    6: '<< /Type /StructTreeRoot /K [8 0 R] /ParentTree 9 0 R /ParentTreeNextKey 1 >>',
    7: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    8: `<< /Type /StructElem /S /Document /P 6 0 R /K [${refs}] >>`,
    9: `<< /Nums [0 [${refs}]] >>`,
  }
  elements.forEach((element, index) => { objects[first + index] = element })
  const info = first + lines.length
  objects[info] = `<< /Title ${literal(title)} /Producer (Beam) >>`
  let pdf = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  for (let n = 1; n <= info; n++) { offsets[n] = pdf.length; pdf += `${n} 0 obj\n${objects[n]}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 ${info + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Every character above is one byte (latin1), so string offsets are byte offsets.
  const bytes = new Uint8Array(new ArrayBuffer(pdf.length))
  for (let index = 0; index < pdf.length; index++) bytes[index] = pdf.charCodeAt(index)
  return bytes
}
