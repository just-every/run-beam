// One renderer for staff preview, review and the actual learner lesson.
import type { Bindings } from '../../auth.server'
import { embedPolicy, safeUrl, type Block } from '../media'
import { h, raw, lessonText, type Html } from './html'

function richText(text: string) {
  const formatted = lessonText(text).html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/_([^_\n]+)_/g, '<em>$1</em>').replace(/`([^`\n]+)`/g, '<code>$1</code>')
  return raw(formatted)
}
export function renderBlocks(blocks: Block[] | undefined, hosts: string[]): Html {
  return h`${(blocks ?? []).map(block => {
    const source = `/app/files/source/${encodeURIComponent(block.source ?? '')}`
    let content: Html
    if (block.kind === 'text') content = richText(block.text)
    else if (block.kind === 'image') content = h`<figure><img class="lesson-image" src="${source}" alt="${block.text}" loading="lazy"><figcaption>${block.text}</figcaption></figure>`
    else if (block.kind === 'audio' || block.kind === 'video') content = h`<figure>${block.kind === 'audio' ? h`<audio controls preload="metadata" src="${source}" aria-label="${block.text}"></audio>` : h`<video controls preload="metadata" src="${source}" aria-label="${block.text}"></video>`}<figcaption>${block.text} · <a href="${source}" download>Download original</a></figcaption></figure>`
    else if (block.kind === 'document') content = h`<figure><iframe class="lesson-document" src="${source}" title="${block.text}" sandbox="" loading="lazy"></iframe><figcaption><a href="${source}">${block.text} (PDF)</a></figcaption></figure>`
    else if (block.kind === 'link') content = h`<p><a href="${block.url}" target="_blank" rel="noopener noreferrer">${block.text}</a></p>`
    else if (block.kind === 'embed') {
      let admitted = false
      try { admitted = hosts.includes(safeUrl(block.url!).hostname) } catch { /* old untrusted data remains inert */ }
      content = admitted ? h`<figure><iframe class="lesson-embed" src="${block.url}" title="${block.text}" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin" loading="lazy" allowfullscreen></iframe><figcaption>${block.text}</figcaption></figure>` : h`<p class="flash">${block.text}: this embed is unavailable under the owner’s current allowlist.</p>`
    } else content = h`<fieldset><legend>${block.text}</legend><p class="muted">Practice check</p>${block.choices?.map((choice, index) => h`<label class="check"><input type="radio" name="check-${block.id}" value="${index}"> ${choice}</label>`)}<details><summary>Check your answer</summary><p>${block.choices?.[block.answer ?? 0]}</p><p>${block.feedback}</p></details></fieldset>`
    return h`<section class="lesson-block" data-block="${block.id}">${content}${block.copiedFrom ? h`<p class="muted">Reused from ${block.copiedFrom.courseTitle ?? 'another course'}${block.copiedFrom.lessonTitle ? ` · ${block.copiedFrom.lessonTitle}` : ''}</p>` : ''}</section>`
  })}`
}
export async function mediaPage(env: Bindings, response: Response) {
  const { hosts } = await embedPolicy(env)
  response.headers.set('content-security-policy', response.headers.get('content-security-policy') + `; frame-src 'self' ${hosts.map(host => 'https://' + host).join(' ')}`)
  return response
}
