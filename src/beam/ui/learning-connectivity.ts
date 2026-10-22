import type { Actor } from '../actor'
import { h, type Html } from './html'

const words = {
  en: {
    ready: 'Saving requires a connection.',
    local: 'Pending: your evidence and chosen file are on this page only. Keep this page open until Beam confirms the save.',
    sending: 'Sending to Beam… Waiting for confirmation.',
    interrupted: 'Save not confirmed. Keep this page open; your work is still here. Reconnect and retry.',
    disconnected: 'Connection interrupted. Nothing is sent automatically.',
    connected: 'Connection available. Retry any unconfirmed save when you are ready.',
    saved: 'Saved on Beam.',
    retry: 'Retry save',
    refused: 'Save refused. Your work remains on this page. Review it and try again.',
    changed: 'Your sign-in changed. Private entries have been cleared. Open My learning to continue.',
    continue: 'Continue',
    pageOnly: 'Unsent entries stay only on this open page. Leaving or reloading clears them.',
    noScript: 'With scripts disabled, this form needs a connection. Keep a separate copy of evidence before submitting.',
  },
  es: {
    ready: 'Se necesita conexión para guardar.',
    local: 'Pendiente: tus pruebas y el archivo elegido están solo en esta página. Mantenla abierta hasta que Beam confirme que se guardaron.',
    sending: 'Enviando a Beam… Esperando confirmación.',
    interrupted: 'Guardado sin confirmar. Mantén esta página abierta; tu trabajo sigue aquí. Reconecta y vuelve a intentarlo.',
    disconnected: 'Conexión interrumpida. No se envía nada automáticamente.',
    connected: 'Conexión disponible. Vuelve a intentar cualquier guardado sin confirmar cuando estés listo.',
    saved: 'Guardado en Beam.',
    retry: 'Reintentar guardado',
    refused: 'Se rechazó el guardado. Tu trabajo sigue en esta página. Revísalo y vuelve a intentarlo.',
    changed: 'Cambió tu sesión. Se borraron las entradas privadas. Abre Mi aprendizaje para continuar.',
    continue: 'Continuar',
    pageOnly: 'Las entradas sin enviar permanecen solo en esta página abierta. Al salir o recargar se borran.',
    noScript: 'Con los scripts desactivados, este formulario necesita conexión. Conserva una copia de las pruebas antes de enviarlas.',
  },
}

/** No queue or browser storage: a failed save retains the live form and File until an explicit retry. */
export function learningSave(actor: Actor, content: Html, saved: string): Html {
  const text = words[actor.locale === 'es-US' ? 'es' : 'en']
  return h`<section data-learning-save data-learner="${actor.id}"><p class="muted" data-save-baseline>${saved}</p><p role="status" aria-live="polite" aria-atomic="true" data-save-status>${text.ready}</p><p class="muted" role="status" aria-live="polite" data-save-connection></p>${content}<p class="muted hint">${text.pageOnly}</p><noscript><p>${text.noScript}</p></noscript></section>`
}

/** Fetch is permitted only on the two learner pages using this enhancement. */
export function learningSavePage(response: Response) {
  response.headers.set('content-security-policy', response.headers.get('content-security-policy') + "; connect-src 'self'")
  return response
}

export const learningConnectivityScript = String.raw`
(() => {
  const copy = ${JSON.stringify(words)};
  const text = copy[document.documentElement.lang === 'es-US' ? 'es' : 'en'];
  for (const panel of document.querySelectorAll('[data-learning-save]')) {
    const form = panel.querySelector('form');
    if (!form) continue;
    const button = form.querySelector('button[type=submit]');
    const status = panel.querySelector('[data-save-status]');
    const connection = panel.querySelector('[data-save-connection]');
    const initialLabel = button.textContent;
    let pending = false, busy = false, saved = false, ended = false, snapshot = null, request = null;
    const fields = [...form.querySelectorAll('input:not([type=hidden]), textarea, select')];
    const lock = value => fields.forEach(field => { field.disabled = value; });
    const clear = () => {
      ended = true; pending = false; snapshot = null;
      request?.abort();
      form.reset();
      // A reset alone can restore server-provided defaults; explicitly remove private input.
      fields.forEach(field => { field.value = ''; field.disabled = true; });
      button.disabled = true;
      panel.querySelector('[data-save-baseline]').textContent = '';
      panel.querySelector('[data-save-continue]')?.remove();
    };
    const identity = async () => {
      const response = await fetch('/api/beam/me', { credentials: 'same-origin', cache: 'no-store', signal: request?.signal });
      if (response.status === 401 || response.status === 403) { clear(); status.textContent = text.changed; return false; }
      if (!response.ok) throw new Error('identity_unavailable');
      const actor = await response.json();
      if (actor.id !== panel.dataset.learner || actor.viewAs) { clear(); status.textContent = text.changed; return false; }
      return !ended;
    };
    form.addEventListener('input', () => {
      if (ended || saved || snapshot) return;
      pending = true;
      status.textContent = text.local;
    });
    form.addEventListener('change', () => {
      if (ended || saved || snapshot) return;
      pending = true;
      status.textContent = text.local;
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || ended || saved) return;
      if (!snapshot && !form.reportValidity()) return;
      pending = true; busy = true; button.disabled = true;
      status.textContent = text.sending;
      // Retain exactly the attempted bytes while the result is uncertain. Retry sends the same submission id.
      if (!snapshot) snapshot = new FormData(form);
      lock(true);
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 30000);
      try {
        if (!await identity()) return;
        const action = new URL(form.action).pathname.split('/').pop();
        const response = await fetch('/api/beam/' + action, {
          method: 'POST', credentials: 'same-origin', body: snapshot, signal: request.signal,
          headers: { Accept: 'application/json' },
        });
        if (ended) return;
        if (response.status === 401 || response.status === 403) { clear(); status.textContent = text.changed; return; }
        if (!response.ok) {
          // A definitive refusal can be corrected. An unavailable server leaves the outcome uncertain.
          if (response.status >= 500) throw new Error('server_unavailable');
          snapshot = null; lock(false); button.textContent = initialLabel;
          status.textContent = text.refused;
          return;
        }
        await response.json();
        pending = false; saved = true; snapshot = null;
        status.textContent = text.saved;
        panel.querySelector('[data-save-baseline]').textContent = '';
        button.remove();
        const next = document.createElement('a');
        next.className = 'button'; next.dataset.saveContinue = '';
        next.href = form.elements.namedItem('returnTo').value;
        next.textContent = text.continue;
        panel.append(next);
        next.focus();
      } catch {
        if (!ended) { status.textContent = text.interrupted; button.textContent = text.retry; }
      } finally {
        clearTimeout(timeout); busy = false; request = null;
        if (!ended && !saved) button.disabled = false;
      }
    });
    addEventListener('offline', () => { if (!ended) connection.textContent = text.disconnected; });
    addEventListener('online', () => {
      if (!ended) { connection.textContent = text.connected; identity().catch(() => {}); }
    });
    addEventListener('focus', () => { if (!ended) identity().catch(() => {}); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !ended) identity().catch(() => {});
    });
    addEventListener('beforeunload', event => { if (pending && !ended) { event.preventDefault(); event.returnValue = ''; } });
    // Prevent history/BFCache from retaining a private draft across sign-out or an account switch.
    addEventListener('pagehide', clear);
    addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
    if (!navigator.onLine) connection.textContent = text.disconnected;
    panel.dataset.saveEnhanced = 'true';
  }
})();
`

export const learningConnectivityResponse = () => new Response(learningConnectivityScript, { headers: {
  'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
}})
