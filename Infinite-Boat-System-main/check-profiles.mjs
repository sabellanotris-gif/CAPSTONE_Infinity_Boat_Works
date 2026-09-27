import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envRaw = readFileSync(join(__dirname, '.env'), 'utf8');
const env = Object.fromEntries(
  envRaw.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
    const [k, ...rest] = l.split('=');
    return [k.trim(), rest.join('=').trim()];
  })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Find the admin profile(s)
const { data, error } = await supabase
  .from('profiles')
  .select('id, email, name, role');

if (error) {
  console.error('Query error:', error.message);
  process.exit(1);
}

console.log('Program names in profiles table:');
(data || []).forEach(p => console.log(`  email=${p.email} | name="${p.name}" | role=${p.role} | id=${p.id}`));
