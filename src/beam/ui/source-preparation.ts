// Server-rendered preparation uses ordinary forms: opening an original never
// creates lessons; only the author's explicit reviewed conversion edits a draft.
import type { Bindings } from '../../auth.server'
import type { Actor } from '../actor'
import { BeamError } from '../core'
import { courseDetail, listCourses } from '../courses'
import { sourceExtraction } from '../source-extraction'
import type { SourceBlock } from '../source-document'
import { area, backLink, card, field, form, h, hidden, lessonText, page, select, type Html } from './html'

function editableBlock(block: SourceBlock, index: number, assets: { id: string; href: string }[], control: string): Html {
  if (block.kind === 'image') {
    const asset = assets.find(item => item.id === block.asset)
    return h`<fieldset><legend>Image ${index + 1}</legend>${asset ? h`<img class="lesson-image" src="${asset.href}" alt="${block.text}" loading="lazy">` : ''}${area('Accessible image description', 'imageDescriptions', block.text)}<p class="muted">Check the diagram against the original. The source version stays with this image.</p></fieldset>`
  }
  return h`<fieldset><legend>${block.text}</legend><label class="check"><input type="checkbox" name="tableHeaders" value="${control}" ${block.table?.[0]?.every(cell => cell.header) ? 'checked' : ''}> First row contains column headings</label><div class="table-wrap"><table><tbody>${block.table?.map((row, rowIndex) => h`<tr>${row.map((cell, column) => h`<td colspan="${cell.colSpan}" rowspan="${cell.rowSpan}">${field(`Row ${rowIndex + 1}, cell ${column + 1}`, 'tableCells', { value: cell.text, required: false })}</td>`)}</tr>`)}</tbody></table></div></fieldset>`
}

export async function sourcePreparationPage(env: Bindings, actor: Actor, version: string, url: URL) {
  const current = '/app/sources', back = `/app/sources/${version}/prepare`
  let extracted: Awaited<ReturnType<typeof sourceExtraction>>
  try { extracted = await sourceExtraction(env, actor, version) }
  catch (error) {
    if (!(error instanceof BeamError) || error.status !== 422) throw error
    return page('Prepare source lessons', actor, h`${backLink(current, 'Sources')}<h1>This source needs attention</h1>${card('Extraction refused', h`<p>The document could not be safely extracted (${error.code}). The unchanged original remains in Sources. Correct the file or use a supported document before preparing lessons.</p>`)}`, { current, url, status: 422 })
  }
  const courses = (await listCourses(env)).filter(course => !course.retiredAt && !course.archivedAt)
  const courseId = url.searchParams.get('course') ?? ''
  const course = courseId ? await courseDetail(env, actor, courseId) : null
  const original = card('Original source', h`<p><strong>${extracted.title} · version ${extracted.number}</strong></p><p>${extracted.filename}</p><p>${extracted.provenance}</p><p><a class="button secondary" href="${extracted.original}" target="_blank" rel="noopener noreferrer">Open original file</a></p><p class="muted">Open the original beside this page. Compare every passage, table and image at its location before saving. Uploaded HTML stays inert; Office documents download for opening in your document viewer.</p><details><summary>Version identity</summary><p class="source-digest">SHA-256 ${extracted.sha256}</p></details>${extracted.assets.length ? h`<h3>Embedded original images</h3>${extracted.assets.map(asset => h`<figure><img class="lesson-image" src="${asset.href}" alt="Embedded original image; compare with its description in the extracted lesson" loading="lazy"><figcaption>${asset.filename}</figcaption></figure>`)}` : ''}`)
  const warnings = card('Check extraction warnings', h`<ul>${extracted.warnings.map(warning => h`<li>${warning}</li>`)}</ul>${extracted.uncertainties.map(item => h`<section class="flash"><h3>${item.location}</h3><p>${item.reason}</p>${item.requiresOcr ? h`<p><a href="/app/sources/${version}/ocr">Ask the owner to authorize OCR for this original</a></p><p>Actual OCR is required. This source cannot be converted until an authorized OCR result is available.</p>` : ''}</section>`)}`)
  const picker = card('Choose a draft course', courses.length ? h`<form method="get" action="${back}">${select('Draft course', 'course', courses.map(item => ({ value: item.id, label: item.title })), courseId, { blank: 'Choose a course' })}<button type="submit" class="secondary">Prepare for this course</button></form>` : h`<p><a href="/app/courses">Create a course</a> before adding reviewed lessons.</p>`)
  const canConvert = !extracted.uncertainties.some(item => item.requiresOcr)
  const lessons = card('Review extracted lessons', h`${extracted.lessons.map((lesson, index) => h`<fieldset><legend>Lesson ${index + 1}</legend>${course ? h`${field('Lesson title', 'lessonTitles', { value: lesson.title })}${area('Lesson text', 'lessonBodies', lesson.body, false)}${lesson.blocks?.map((block, blockIndex) => editableBlock(block, blockIndex, extracted.assets, `${index}:${blockIndex}`))}` : h`<h3>${lesson.title}</h3><div class="lesson-body">${lessonText(lesson.body)}</div>${lesson.blocks?.map(block => block.kind === 'image' ? h`<p>Image: ${block.text}</p>` : h`<div class="table-wrap"><table><tbody>${block.table?.map(row => h`<tr>${row.map(cell => h`<td colspan="${cell.colSpan}" rowspan="${cell.rowSpan}">${cell.text}</td>`)}</tr>`)}</tbody></table></div>`)}`}<details><summary>Extracted passages and source locations</summary>${extracted.passages.filter(passage => passage.lesson === index).map(passage => h`<section><h4>${passage.location}</h4><div class="lesson-body">${lessonText(passage.text)}</div></section>`)}</details></fieldset>`)}`)
  const comparison = h`<div class="split source-comparison">${original}${lessons}</div>`
  const reviewed = h`<label class="check"><input type="checkbox" name="reviewed" value="yes" required> I compared the extracted lessons, tables and images with this original version and corrected the material.</label>${extracted.uncertainties.filter(item => !item.requiresOcr).map(item => h`<label class="check"><input type="checkbox" name="resolvedUncertainties" value="${item.id}" required> I checked and corrected ${item.location} against the original.</label>`)}<p class="muted">This adds editable draft lessons. Submit the draft afterwards; the named reviewer must approve publication.</p>`
  const body = h`${backLink(current, 'Sources')}<h1>Prepare lessons from ${extracted.title}</h1><p class="lede">Compare the unchanged original, correct the extraction, then add it to a draft.</p>${warnings}${picker}${course ? h`<h2>${course.title} · draft version ${course.draftVersion}</h2>${canConvert ? form('source.convert', `/app/courses/${courseId}`, [hidden('sourceVersion', version), hidden('course', courseId), hidden('draftVersion', course.draftVersion), comparison, reviewed], 'Add reviewed lessons to draft', { className: 'source-preparation' }) : h`${comparison}<p class="flash" role="status">This document contains pages requiring OCR. Review the original; no draft conversion is available without actual OCR.</p>`}` : comparison}`
  return page('Prepare source lessons', actor, body, { current, url, wide: true })
}
