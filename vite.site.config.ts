import { defineConfig } from 'vite'
import { docsSite } from './src/site/docs/plugin.ts'

// The run site's build (rer build --site, src/site/pages.ts): only the docs module its pages need. Never the app's
// vite.config.ts, whose Worker and Start plugins do not run in Node.
export default defineConfig({ plugins: [docsSite()] })
