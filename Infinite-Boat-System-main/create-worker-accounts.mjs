import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://brpblkvthpdfbjqckqbk.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY || SERVICE_ROLE_KEY.length < 20) {
  console.error('Missing or invalid SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const DEFAULT_PASSWORD = 'worker12345';

const headers = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};

function generateEmail(name) {
  const parts = name.toLowerCase()
    .replace(/engr\.\s*/gi, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/);
  return parts.join('.') + '@infinityboatsystem.com';
}

async function apiCall(method, path, body = null) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function createWorkerAccount(worker) {
  const email = generateEmail(worker.name);
  const specialty = worker.specialty || 'Builder';

  console.log(`\n--- Creating account for ${worker.name} (${email}) ---`);

  const { status, data } = await apiCall('POST', '/auth/v1/admin/users', {
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: { name: worker.name, role: 'worker', specialty }
  });

  if (status === 422 || (data && data.msg && data.msg.includes('already'))) {
    console.log(`  Skipped: ${email} already exists.`);

    const listRes = await apiCall('GET', '/auth/v1/admin/users');
    const existingUser = listRes.data?.users?.find(u => u.email === email);
    if (existingUser) {
      await apiCall('POST', '/rest/v1/profiles', {
        id: existingUser.id,
        email,
        name: worker.name,
        role: 'worker'
      });
      await apiCall('PATCH', `/rest/v1/workers?name=eq.${encodeURIComponent(worker.name)}`, {
        userId: existingUser.id
      });
      console.log(`  Linked existing user to workers table.`);
    }
    return false;
  }

  if (status !== 200 && status !== 201) {
    console.error(`  Failed: status ${status}`, typeof data === 'object' ? JSON.stringify(data) : data);
    return false;
  }

  const userId = data.id;
  console.log(`  Auth user created: ${userId}`);

  await apiCall('POST', '/rest/v1/profiles', {
    id: userId,
    email,
    name: worker.name,
    role: 'worker'
  });
  console.log(`  Profile created.`);

  const linkRes = await apiCall('PATCH', `/rest/v1/workers?name=eq.${encodeURIComponent(worker.name)}`, {
    userId
  });
  if (linkRes.status >= 200 && linkRes.status < 300) {
    console.log(`  Linked to workers table.`);
  } else {
    console.error(`  Link failed:`, JSON.stringify(linkRes.data));
  }

  const regRes = await apiCall('POST', '/rest/v1/worker_registrations', {
    userId,
    email,
    name: worker.name,
    specialty,
    status: 'approved',
    reviewedAt: new Date().toISOString()
  });
  if (regRes.status >= 200 && regRes.status < 300) {
    console.log(`  Registration record created (approved).`);
  } else {
    console.error(`  Registration failed:`, JSON.stringify(regRes.data));
  }

  console.log(`  Account ready: ${email} / ${DEFAULT_PASSWORD}`);
  return true;
}

async function main() {
  console.log('=== Create Worker Accounts Script ===\n');
  console.log('Supabase URL:', SUPABASE_URL);

  const workersRes = await apiCall('GET', '/rest/v1/workers?select=*&order=name');
  const workers = workersRes.data;

  if (!workers || workers.length === 0) {
    console.log('No workers found in the registry. Seed workers first.');
    process.exit(1);
  }

  console.log(`Found ${workers.length} workers in registry.\n`);

  let created = 0;
  let skipped = 0;

  for (const worker of workers) {
    if (worker.userId) {
      console.log(`\n--- ${worker.name} ---`);
      console.log(`  Skipped: already has a linked account.`);
      skipped++;
      continue;
    }

    const ok = await createWorkerAccount(worker);
    if (ok) created++;
    else skipped++;
  }

  console.log('\n=== Summary ===');
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total:   ${workers.length}`);
  console.log(`\nAll worker accounts use password: ${DEFAULT_PASSWORD}`);
  console.log('Workers can now log in at http://localhost:3000/login.html');
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
