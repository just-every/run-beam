// LEARN-015: drag-and-drop for matching questions, layered over the labelled selects, which stay the keyboard and
// screen-reader door. Drag an answer onto an item, or tap an answer and then the item, and that item's select takes
// the answer; the answers already used are marked. Without this script the selects work alone.
for (const fieldset of document.querySelectorAll('fieldset[data-match]')) {
  const pairs = [...fieldset.querySelectorAll('.match-pair')]
  const selects = pairs.map(pair => pair.querySelector('select'))
  if (!selects.length) continue
  const bank = document.createElement('div')
  bank.className = 'drag-bank'
  bank.setAttribute('aria-hidden', 'true')
  let picked = null
  const chips = [...selects[0].options].filter(option => option.value !== '').map(option => {
    const chip = document.createElement('span')
    chip.className = 'drag-chip'
    chip.draggable = true
    chip.textContent = option.textContent
    chip.dataset.value = option.value
    chip.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', option.value); event.dataTransfer.effectAllowed = 'move' })
    chip.addEventListener('click', () => { picked = picked === chip ? null : chip; for (const other of chips) other.classList.toggle('picked', other === picked) })
    bank.append(chip)
    return chip
  })
  const mark = () => { const used = new Set(selects.map(select => select.value)); for (const chip of chips) chip.classList.toggle('used', used.has(chip.dataset.value)) }
  pairs.forEach((pair, index) => {
    const select = selects[index]
    const put = value => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) }
    pair.classList.add('drag-target')
    pair.addEventListener('dragover', event => { event.preventDefault(); pair.classList.add('over') })
    pair.addEventListener('dragleave', () => pair.classList.remove('over'))
    pair.addEventListener('drop', event => { event.preventDefault(); pair.classList.remove('over'); put(event.dataTransfer.getData('text/plain')) })
    pair.addEventListener('click', event => { if (picked && event.target !== select) { put(picked.dataset.value); picked.classList.remove('picked'); picked = null } })
    select.addEventListener('change', mark)
  })
  fieldset.querySelector('legend').after(bank)
  mark()
}
