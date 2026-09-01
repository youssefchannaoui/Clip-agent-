import test from 'node:test';
import assert from 'node:assert/strict';

// Own port window below the Linux ephemeral range, per the house rule.
process.env.PORT = String(18620 + Math.floor(Math.random() * 100));
process.env.DATA_DIR = `/tmp/dc-email-notifs-${Date.now()}`;
process.env.AUTH_REQUIRED = 'true';
process.env.BACKUP_ENABLED = 'false';

const { server } = await import('../src/server.js');
const { state, emailNotifsOff } = await import('../src/store.js');
const auth = await import('../src/auth.js');

const base = `http://127.0.0.1:${process.env.PORT}`;
for (let i = 0; i < 50; i++) {
  try { await fetch(`${base}/healthz`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
}

const user = { id: 'mailpref-1', email: 'mailpref@deenclipped.test', name: 'Pref', role: 'creator', providers: {}, createdAt: Date.now() };
state.authUsers.push(user);
const cookie = `dc_session=${auth.createSession(user, { provider: 'test' })}`;

test('product emails default ON, and the toggle round-trips through the API', async () => {
  assert.equal(emailNotifsOff(user.id), false, 'absence of the key means on');

  const before = await (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json();
  assert.equal(before.emailNotifs, true, 'the payload says emails are on');

  const off = await fetch(`${base}/api/notifications/email`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: false }),
  });
  assert.equal(off.status, 200);
  assert.equal(emailNotifsOff(user.id), true, 'the gate the senders check flips with it');

  const after = await (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json();
  assert.equal(after.emailNotifs, false);

  const on = await fetch(`${base}/api/notifications/email`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: true }),
  });
  assert.equal(on.status, 200);
  assert.equal(emailNotifsOff(user.id), false);
});

test('the toggle refuses a signed-out caller', async () => {
  const res = await fetch(`${base}/api/notifications/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: false }),
  });
  assert.equal(res.status, 401);
});

test.after(() => { try { server.close(); } catch {} });
