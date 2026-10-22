// Network-edge fixture only: app code always calls the real fixed provider door.
export const syntheticOcrPages = [{ page: 1, passages: [{ text: 'synthetic-beam-1: Inspect the work area before starting.', uncertainties: ['Check the faint final word against the original.'] }], uncertainties: [] }]
export function sourceOcrProviderResponse(pages = syntheticOcrPages, overrides = {}) {
  return { id: 'synthetic-beam-2', status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ pages }) }] }],
    usage: { input_tokens: 1200, output_tokens: 200 }, ...overrides }
}
