// Served as an ES module; the only interpreted document is the installed PDF.js
// parser. Source text enters textContent, and source graphics enter a canvas.
export const pdfViewerClient = String.raw`
import { getDocument, AnnotationMode } from '/app/pdf-library.mjs';

const status = document.getElementById('pdf-status');
const position = document.getElementById('pdf-position');
const stage = document.getElementById('pdf-stage');
const canvas = document.getElementById('pdf-canvas');
const pageText = document.getElementById('pdf-page-text');
const previous = document.getElementById('pdf-previous');
const next = document.getElementById('pdf-next');
const zoom = document.getElementById('pdf-zoom');
const MAX_PIXELS = 4000000, MAX_SIDE = 16384, MAX_PAGES = 60;
let loading, pdf, drawing, current = 1, pending, running = false, closed = false;

function controls(busy) {
  previous.disabled = busy || !pdf || current <= 1;
  next.disabled = busy || !pdf || current >= pdf.numPages;
  zoom.disabled = busy || !pdf;
  stage.setAttribute('aria-busy', String(busy));
}
function failure(message) {
  canvas.hidden = true;
  canvas.width = canvas.height = 0;
  pageText.textContent = '';
  status.textContent = message + ' Download the original from the lesson to inspect it.';
}
function request(page = current) {
  if (!pdf || closed) return;
  pending = Math.max(1, Math.min(pdf.numPages, page));
  void renderPending();
}
async function renderPending() {
  if (running) return;
  running = true;
  try {
    while (pending && !closed) {
      const number = pending;
      pending = undefined;
      current = number;
      controls(true);
      position.textContent = 'Page ' + number + ' of ' + pdf.numPages;
      status.textContent = 'Rendering page ' + number + '…';
      canvas.hidden = true;
      pageText.textContent = '';
      let page, timer;
      try {
        page = await pdf.getPage(number);
        const natural = page.getViewport({ scale: 1 });
        if (!Number.isFinite(natural.width) || !Number.isFinite(natural.height) || natural.width <= 0 || natural.height <= 0) throw new Error('Page geometry');
        const scale = zoom.value === 'fit' ? Math.min(4, Math.max(0.1, stage.clientWidth / natural.width)) : Number(zoom.value) * 96 / 72;
        if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new Error('Zoom');
        const viewport = page.getViewport({ scale });
        if (viewport.width > MAX_SIDE || viewport.height > MAX_SIDE) throw new Error('Page size');
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        canvas.setAttribute('aria-label', 'Original PDF page ' + number + ' of ' + pdf.numPages);
        drawing = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: AnnotationMode.DISABLE, background: 'white' });
        timer = setTimeout(() => drawing?.cancel(), 15000);
        await drawing.promise;
        clearTimeout(timer);
        if (closed) break;
        const extracted = await page.getTextContent();
        if (extracted.items.length > 20000) throw new Error('Page text size');
        let text = '';
        for (const item of extracted.items) if (typeof item.str === 'string') {
          text += item.str + (item.hasEOL ? '\n' : ' ');
          if (text.length > 50000) throw new Error('Page text size');
        }
        pageText.textContent = text.trim() || 'This page has no selectable text. Its original graphics are shown above.';
        canvas.hidden = false;
        canvas.dataset.page = String(number);
        status.textContent = 'Page ' + number + ' of ' + pdf.numPages + ' · original PDF';
      } catch {
        if (!closed) failure('This page could not be rendered safely.');
      } finally {
        if (timer) clearTimeout(timer);
        drawing = undefined;
        page?.cleanup();
      }
    }
  } finally {
    running = false;
    if (!closed) controls(false);
  }
}

previous.addEventListener('click', () => request(current - 1));
next.addEventListener('click', () => request(current + 1));
zoom.addEventListener('change', () => request());
let width = stage.clientWidth;
const resize = new ResizeObserver(() => {
  const changed = Math.abs(stage.clientWidth - width) >= 1;
  width = stage.clientWidth;
  if (changed && zoom.value === 'fit') request();
});
resize.observe(stage);
window.addEventListener('pagehide', () => {
  closed = true;
  pending = undefined;
  resize.disconnect();
  drawing?.cancel();
  if (loading) void loading.destroy().catch(() => {});
}, { once: true });

async function openOriginal() {
  let timer;
  try {
    const retained = document.getElementById('pdf-data');
    const encoded = retained.textContent.trim();
    retained.remove();
    if (!encoded.length || encoded.length > 13333336) throw new Error('File size');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    if (bytes.length > 10000000) throw new Error('File size');
    loading = getDocument({ data: bytes, useWorkerFetch: false, useSystemFonts: true, disableFontFace: true,
      enableXfa: false, useWasm: false, stopAtErrors: true, maxImageSize: MAX_PIXELS, canvasMaxAreaInBytes: MAX_PIXELS * 4,
      cMapUrl: undefined, standardFontDataUrl: undefined, wasmUrl: undefined, iccUrl: undefined });
    timer = setTimeout(() => { void loading.destroy().catch(() => {}); }, 15000);
    pdf = await loading.promise;
    if (pdf.numPages < 1 || pdf.numPages > MAX_PAGES || pdf.isPureXfa) throw new Error('Unsupported document');
    if (!closed) request(1);
  } catch {
    pdf = undefined;
    if (!closed) failure('This PDF could not be opened in the protected preview.');
    if (loading) void loading.destroy().catch(() => {});
  } finally {
    if (timer) clearTimeout(timer);
    if (!running && !closed) controls(false);
  }
}
void openOriginal();
`
