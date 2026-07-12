// Try to add role column via various Supabase API endpoints
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://brpblkvthpdfbjqckqbk.supabase.co';
const key = process.argv[2];
if (!key) { console.error('Usage: node add-role-column.js <service_role_key>'); process.exit(1); }

// Create a regular client
const supabase = createClient(SUPABASE_URL, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Try the query endpoint directly (for raw SQL)
const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Accept': 'application/json'
  },
  body: JSON.stringify({
    query: "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';"
  })
});

console.log('Response status:', res.status);
const text = await res.text();
console.log('Response:', text.substring(0, 500));
