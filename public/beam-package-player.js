// The package runs in an opaque sandbox; only this same-origin bridge carries the human session.
const player = document.querySelector('[data-package-player]')
if (player) {
  const frame = player.querySelector('iframe'), status = player.querySelector('[data-package-status]')
  let version = Number(player.dataset.version), queue = Promise.resolve(), failed = false
  window.addEventListener('message', event => {
    const data = event.data
    if (event.source !== frame.contentWindow || !data || data.beamPackage !== player.dataset.session || !['commit', 'terminate'].includes(data.kind)) return
    if (player.dataset.preview === '1') { status.textContent = 'Preview only. No training was recorded.'; return }
    status.textContent = 'Saving… Keep this page open.'
    queue = queue.then(async () => {
      if (failed) return
      try {
        const response = await fetch('/api/beam/package.runtime', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: player.dataset.session, version, event: data.kind, values: data.values }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Save refused')
        version = result.version
        status.textContent = result.completion ? 'Course completed. Your exact revision and package evidence are saved.' : data.kind === 'terminate' ? 'Saved. You can return to the course.' : 'Saved. You can continue or resume on another device.'
        if (result.completion) frame.hidden = true
        if (result.navigationError) status.textContent = 'Saved. The requested next activity is unavailable. Return to the course to check its prerequisites.'
        if (result.next) window.location.assign(result.next)
      } catch (error) { failed = true; status.textContent = 'Your latest changes were not saved. Keep this page open and return to the course to start a new session. ' + error.message }
    })
  })
}
