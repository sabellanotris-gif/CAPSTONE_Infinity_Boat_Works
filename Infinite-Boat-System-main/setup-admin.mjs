import { createClient } from '@supabase/supabase-js';

if (process.argv.length < 3) {
  console.error('Usage: node setup-admin.js <service_role_key> [email]');
  console.error('       Default email: admin@gmail.com');
  console.error('  Also creates:      infinityboatsystem@gmail.com');
  process.exit(1);
}

const SUPABASE_URL = 'https://brpblkvthpdfbjqckqbk.supabase.co';
const SERVICE_ROLE_KEY = process.argv[2];
const PRIMARY_EMAIL = process.argv[3] || 'admin@gmail.com';
const SECONDARY_EMAIL = 'infinityboatsystem@gmail.com';
const password = 'admin12345';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createOrUpdateAdmin(email, displayName) {
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: displayName, role: 'admin' }
  });

  if (userError) {
    if (userError.message?.includes('already registered')) {
      console.log(`User ${email} already exists. Updating profile role to admin...`);
      const { data: existing } = await supabase.auth.admin.listUsers();
      const existingUser = existing?.users?.find(u => u.email === email);
      if (existingUser) {
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: existingUser.id,
          email,
          name: displayName,
          role: 'admin'
        }, { onConflict: 'id' });
        if (profileError) {
          console.error(`Profile update failed for ${email}:`, profileError.message);
        } else {
          console.log(`Admin profile updated for ${email}!`);
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
    name: displayName,
    role: 'admin'
  }, { onConflict: 'id' });

  if (profileError) {
    console.error(`Profile insert failed for ${email}:`, profileError.message);
    return false;
  }
  console.log(`Admin account created: ${email}`);
  return true;
}

const primaryOk = await createOrUpdateAdmin(PRIMARY_EMAIL, 'admin');
const secondaryOk = await createOrUpdateAdmin(SECONDARY_EMAIL, 'admin');

if (primaryOk || secondaryOk) {
  console.log('\nAdmin accounts ready:');
  console.log(`  ${PRIMARY_EMAIL} / ${password}`);
  console.log(`  ${SECONDARY_EMAIL} / ${password}`);
} else {
  console.log('\nNo new accounts created (may already exist with admin role).');
}
