// Every chunk is a separate public request, keeping large originals within the
// Worker's invocation budget. The server re-reads the retained plan for review.
export const importBrowserScript = String.raw`
const form = document.querySelector('[data-import-upload]');
if (form) form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  const progress = document.querySelector('[data-import-progress]');
  button.disabled = true;
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const base64 = bytes => {
    let text = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(text);
  };
  const call = async (action, body) => {
    const response = await fetch('/api/operator/import/' + action, {method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', 'X-Import-Source': 'talentlms'}, body: JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.details?.reason || result.error || 'Upload refused');
    return result;
  };
  const original = async (name, optional = false) => {
    const file = form.elements.namedItem(name)?.files?.[0];
    if (!file || !file.size) {
      if (optional) return null;
      throw new Error('Choose the course list.');
    }
    if (file.size > 10000000) throw new Error('Each file must be no larger than 10 MB.');
    return {filename: file.name, base64: base64(new Uint8Array(await file.arrayBuffer()))};
  };
  try {
    const courseList = await original('courseList'), reports = [], mappings = {};
    for (let slot = 1; slot <= 5; slot++) {
      const file = await original('report' + slot, true);
      if (!file) continue;
      const course = form.elements.namedItem('report' + slot + 'Course').value.trim();
      if (!course) throw new Error('Name the TalentLMS course ID for each report.');
      reports.push({course, file});
      const mapped = form.elements.namedItem('report' + slot + 'Mapping').value;
      if (mapped) mappings[course] = mapped;
    }
    const bytes = new TextEncoder().encode(JSON.stringify({courseList, reports, mappings, dateFormat: form.elements.namedItem('dateFormat').value}));
    const bundleSha256 = await hash(bytes), totalChunks = Math.ceil(bytes.length / 65536);
    let uploadId;
    for (let index = 0; index < totalChunks; index++) {
      progress.textContent = 'Uploading ' + (index + 1) + ' of ' + totalChunks + ' parts…';
      const chunk = bytes.subarray(index * 65536, (index + 1) * 65536);
      const result = await call('uploads', {uploadId, name: 'talentlms.json', bundleSha256, totalBytes: bytes.length,
        totalChunks, index, chunkSha256: await hash(chunk), base64: base64(chunk)});
      uploadId = result.uploadId;
    }
    const inventory = await call('uploads', {uploadId});
    if (!inventory.complete) throw new Error('The upload is incomplete.');
    const retained = document.createElement('input');
    retained.type = 'hidden'; retained.name = 'uploadId'; retained.value = uploadId;
    form.append(retained);
    for (const file of form.querySelectorAll('input[type=file]')) file.disabled = true;
    progress.textContent = 'Preparing your preview…';
    form.submit();
  } catch (error) {
    progress.textContent = error instanceof Error ? error.message : 'The upload could not finish.';
    button.disabled = false;
  }
});
`

export const importBrowserResponse = () => new Response(importBrowserScript, {headers: {
  'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
}})
