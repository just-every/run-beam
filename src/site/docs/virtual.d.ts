declare module 'virtual:beam-docs' {
  export const sections: { title: string; pages: { slug: string; title: string; file: string; summary: string }[] }[]
  export const bodies: Record<string, { html: string; toc: { depth: number; id: string; text: string }[] }>
}
