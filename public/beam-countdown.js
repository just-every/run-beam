// LEARN-018: the timed quiz's countdown. The server's deadline and clock are on
// the element, so a wrong device clock does not move the limit. The visible
// clock is hidden from screen readers; warnings are announced once each.
const clock = document.querySelector('[data-deadline]')
if (clock) {
  const deadline = Number(clock.dataset.deadline)
  const skew = Number(clock.dataset.now) - Date.now()
  const shown = clock.querySelector('[data-left]')
  const status = document.getElementById('time-status')
  const warned = new Set()
  const warnings = [[300, clock.dataset.warningFive], [60, clock.dataset.warningOne]]
  const tick = () => {
    const left = Math.max(0, Math.round((deadline - (Date.now() + skew)) / 1000))
    shown.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
    for (const [at, message] of warnings) if (left <= at && left > 0 && !warned.has(at)) { warned.add(at); status.textContent = message }
    if (left === 0) {
      status.textContent = clock.dataset.expired
      clearInterval(timer)
      setTimeout(() => location.reload(), 1500)
    }
  }
  const timer = setInterval(tick, 1000)
  tick()
}
