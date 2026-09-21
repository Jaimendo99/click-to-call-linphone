import assert from 'node:assert/strict';
import test from 'node:test';
import { importSample, login, request, startTestServer } from './helpers.js';

test('admin and advisor permissions are enforced server-side', async () => {
  const ctx = await startTestServer();
  try {
    const admin = await login(ctx.url, 'admin', 'adminpass1');
    await request(ctx.url, admin.jar, '/api/admin/users', {
      method: 'POST',
      body: {
        name: 'Maria Perez',
        username: 'maria',
        password: 'advisorpass1',
        role: 'advisor',
      },
    });
    await request(ctx.url, admin.jar, '/api/admin/users', {
      method: 'POST',
      body: {
        name: 'Pedro Gomez',
        username: 'pedro',
        password: 'advisorpass1',
        role: 'advisor',
      },
    });
    await importSample(ctx.url, admin.jar);

    const maria = await login(ctx.url, 'maria', 'advisorpass1');
    const pedro = await login(ctx.url, 'pedro', 'advisorpass1');

    const users = await request(ctx.url, maria.jar, '/api/admin/users');
    assert.equal(users.status, 403);

    const preview = await request(ctx.url, maria.jar, '/api/admin/import/preview', {
      method: 'POST',
      body: new FormData(),
    });
    assert.equal(preview.status, 403);

    const mariaClient = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    const pedroClient = await request(ctx.url, pedro.jar, '/api/advisor/current-client');
    assert.notEqual(mariaClient.data.client.id, pedroClient.data.client.id);

    const steal = await request(
      ctx.url,
      maria.jar,
      `/api/advisor/phone-numbers/${pedroClient.data.client.phones[0].id}/attempt`,
      { method: 'POST', body: { result: 'No contesta' } }
    );
    assert.equal(steal.status, 403);

    const claimBody = await request(ctx.url, maria.jar, '/api/advisor/claim-next-client', {
      method: 'POST',
      body: { clientId: pedroClient.data.client.id },
    });
    assert.equal(claimBody.data.client.id, mariaClient.data.client.id);

    const poolReturn = await request(
      ctx.url,
      maria.jar,
      `/api/admin/clients/${mariaClient.data.client.id}/return-to-pool`,
      { method: 'POST' }
    );
    assert.equal(poolReturn.status, 403);

    const me = await request(ctx.url, maria.jar, '/api/me');
    assert.equal(me.data.user.role, 'advisor');
  } finally {
    await ctx.close();
  }
});

test('inactive users cannot log in and passwords are not returned', async () => {
  const ctx = await startTestServer();
  try {
    const admin = await login(ctx.url, 'admin', 'adminpass1');
    const created = await request(ctx.url, admin.jar, '/api/admin/users', {
      method: 'POST',
      body: {
        name: 'Temp',
        username: 'tempuser',
        password: 'advisorpass1',
        role: 'advisor',
      },
    });
    assert.equal(created.data.user.password_hash, undefined);

    await request(ctx.url, admin.jar, `/api/admin/users/${created.data.user.id}`, {
      method: 'PATCH',
      body: { active: false },
    });

    const denied = await login(ctx.url, 'tempuser', 'advisorpass1');
    assert.equal(denied.status, 403);
  } finally {
    await ctx.close();
  }
});
