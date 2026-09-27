import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let SUPABASE_URL = 'https://brpblkvthpdfbjqckqbk.supabase.co';
let SERVICE_ROLE_KEY = process.argv[2];

// Fallback: read credentials from .env when no key is passed as an argument.
if (!SERVICE_ROLE_KEY) {
  try {
    const envRaw = readFileSync(join(__dirname, '.env'), 'utf8');
    const env = Object.fromEntries(
      envRaw.split('\n').filter(l => l && !l.startsWith('#')).map(l => {
        const [k, ...rest] = l.split('=');
        return [k.trim(), rest.join('=').trim()];
      })
    );
    SUPABASE_URL = env.SUPABASE_URL || SUPABASE_URL;
    SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY not set in .env');
      process.exit(1);
    }
  } catch (e) {
    console.error('Usage: node setup-manager.mjs <service_role_key> [email]');
    console.error('       (or set SUPABASE_SERVICE_ROLE_KEY in .env)');
    console.error('       Default email: manager@gmail.com');
    process.exit(1);
  }
}

const MANAGER_EMAIL = process.argv[3] || 'manager@gmail.com';
const password = 'manager12345';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createOrUpdateManager(email) {
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: 'Project Manager', role: 'manager' }
  });

  if (userError) {
    if (userError.message?.includes('already registered')) {
      console.log(`User ${email} already exists. Updating profile role to manager...`);
      const { data: existing } = await supabase.auth.admin.listUsers();
      const existingUser = existing?.users?.find(u => u.email === email);
      if (existingUser) {
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: existingUser.id,
          email,
          name: 'Project Manager',
          role: 'manager'
        }, { onConflict: 'id' });
        if (profileError) {
          console.error(`Profile update failed for ${email}:`, profileError.message);
        } else {
          console.log(`Manager profile updated for ${email}!`);
        }
      }
      return false;
    } else {
      console.error(`Failed to create user ${email}:`, userError.message);
      return false;
    }
  }

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: userData.user.id,
    email,
    name: 'Project Manager',
    role: 'manager'
  }, { onConflict: 'id' });

  if (profileError) {
    console.error(`Profile insert failed for ${email}:`, profileError.message);
    return false;
  }
  console.log(`Manager account created: ${email}`);
  return true;
}

const ok = await createOrUpdateManager(MANAGER_EMAIL);

if (ok) {
  console.log('\nManager account ready:');
  console.log(`  ${MANAGER_EMAIL} / ${password}`);
} else {
  console.log('\nNo new account created (may already exist with manager role).');
}