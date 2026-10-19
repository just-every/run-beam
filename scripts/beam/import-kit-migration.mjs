// Writes the next numbered Beam migration for the vendored import-kit D1 schema,
// in the order initializeD1ImportStorage applies it. Run once when adopting a kit
// revision: node --experimental-strip-types scripts/beam/import-kit-migration.mjs OUT.sql BASE_SHA
// It replays the applied import-kit migrations (migrations/core/*import_kit*.sql)
// and keeps only the statements that change that schema, then refuses unless the
// result equals a fresh install. Never rewrite an applied migration.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [out, revision, withDoor] = process.argv.slice(2);
if (!out || !/^[0-9a-f]{7,40}$/.test(revision ?? '')) throw Error('Usage: import-kit-migration.mjs OUT.sql BASE_SHA');
const d1 = await import('../../src/modules/import-kit/src/d1/index.ts');
const groups = [d1.d1Schema, d1.d1ErasureSchema, [...d1.d1StreamOriginSchema, ...d1.d1LegacyStreamReceiptUpgrade], d1.d1StagingSchema, d1.d1NativeStagingSchema, d1.d1CustodyStateSchema, d1.d1ReversalFenceSchema, d1.d1PreparationSchema, d1.d1PreparationStepsSchema, d1.d1RetirementSchema, d1.d1CustodyStateReplaceSchema, d1.d1ErasureProgressSchema];
const statements = groups.flat().map(sql => sql.trim().replace(/;\s*$/, ''));
const schema = db => JSON.stringify(db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND tbl_name NOT LIKE 'ik_door_%' ORDER BY type, name").all());
const directory = new URL('../../migrations/core/', import.meta.url);
const applied = new DatabaseSync(':memory:');
for (const name of readdirSync(directory).filter(name => name.includes('import_kit')).sort()) applied.exec(readFileSync(new URL(name, directory), 'utf8'));
const kept = [];
for (const sql of statements) {
  const before = schema(applied);
  try { applied.exec(sql); } catch (error) { if (/already exists|duplicate column/.test(error.message)) continue; throw error; }
  if (schema(applied) !== before) kept.push(sql);
}
const fresh = new DatabaseSync(':memory:');
for (const sql of statements) fresh.exec(sql);
if (schema(applied) !== schema(fresh)) throw Error('The applied migrations plus this upgrade do not equal a fresh import-kit schema; resolve by hand.');
if (withDoor === '--door') {
  if (applied.prepare("SELECT 1 FROM sqlite_master WHERE name='ik_door_plans'").get()) throw Error('Door already installed: add the individual Base door evolutions in new migrations instead.');
  const { importDoorSchema } = await import('../../src/modules/import-kit/src/door/schema.ts');
  for (const sql of importDoorSchema) { applied.exec(sql); fresh.exec(sql); kept.push(sql); }
}
writeFileSync(out, `-- Base import-kit D1 schema upgrade (runeditrun/base ${revision.slice(0, 7)}, modules/import-kit):\n-- the statements the applied import-kit migrations lack. Applying them yields\n-- the same schema as a fresh initializeD1ImportStorage.\n` + kept.map(sql => sql + ';').join('\n') + '\n');
console.log(`${kept.length} of ${statements.length} statements`);
