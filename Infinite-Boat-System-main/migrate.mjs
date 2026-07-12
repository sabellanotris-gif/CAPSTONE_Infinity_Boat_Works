// Run schema migration via Supabase SQL endpoint
// Usage: node migrate.js <service_role_key>
// Reads schema.sql and runs it against the Supabase project.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = 'https://brpblkvthpdfbjqckqbk.supabase.co';

const key = process.argv[2];
if (!key) { console.error('Usage: node migrate.js <service_role_key>'); process.exit(1); }

const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

// Supabase REST SQL endpoint — requires service_role key
const res = await fetch(`${SUPABASE_URL}/rest/v1/sql`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`
  },
  body: JSON.stringify({ query: sql })
});

console.log('Status:', res.status);
const text = await res.text();
if (res.ok) {
  console.log('Migration completed successfully.');
  if (text) console.log('Response:', text.slice(0, 500));
} else {
  console.error('Migration failed:', text);
}
