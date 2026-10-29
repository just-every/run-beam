// CI selects one shared partition; a person's rer verify keeps Beam's existing wall.
import { run } from './verify-app.mjs';

if (process.env.SEED_VERIFY_SHARD) {
  run('node scripts/verify-app.mjs');
} else {
  run('node scripts/edition-authoring/cli.mjs check >/dev/null && node scripts/edition-authoring/cli.mjs verify-base --offline >/dev/null && pnpm run build && pnpm run typecheck && pnpm run test:email-link && pnpm run test:flows && pnpm run test:site');
}
