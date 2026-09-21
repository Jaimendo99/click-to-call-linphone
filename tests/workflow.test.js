import assert from 'node:assert/strict';
import test from 'node:test';
import { importSample, login, request, startTestServer } from './helpers.js';

test('full advisor workflow: restore, feedback, complete, auto-claim next', async () => {
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
    const imported = await importSample(ctx.url, admin.jar);
    assert.equal(imported.commit.data.summary.imported, 5);

    const maria = await login(ctx.url, 'maria', 'advisorpass1');
    const first = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    assert.equal(first.data.client.name, 'John Smith');
    assert.equal(first.data.client.phones.length, 3);
    assert.equal(first.data.client.status, 'in_progress');
    assert.equal(first.data.previous, null);
    assert.equal(first.data.remaining, 4);

    const again = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    assert.equal(again.data.client.id, first.data.client.id);

    const missingResult = await request(
      ctx.url,
      maria.jar,
      `/api/advisor/phone-numbers/${first.data.client.phones[0].id}/attempt`,
      { method: 'POST', body: { notes: 'forgot result' } }
    );
    assert.equal(missingResult.status, 400);

    const saveOne = await request(
      ctx.url,
      maria.jar,
      `/api/advisor/phone-numbers/${first.data.client.phones[0].id}/attempt`,
      { method: 'POST', body: { result: 'No contesta', notes: 'ring timeout' } }
    );
    assert.equal(saveOne.data.clientCompleted, false);
    assert.equal(saveOne.data.client.id, first.data.client.id);
    assert.equal(saveOne.data.client.progress.completed, 1);

    await request(
      ctx.url,
      maria.jar,
      `/api/advisor/phone-numbers/${first.data.client.phones[1].id}/attempt`,
      { method: 'POST', body: { result: 'Número equivocado' } }
    );

    const last = await request(
      ctx.url,
      maria.jar,
      `/api/advisor/phone-numbers/${first.data.client.phones[2].id}/attempt`,
      { method: 'POST', body: { result: 'Interesado', notes: 'wants info' } }
    );
    assert.equal(last.data.clientCompleted, true);
    assert.equal(last.data.client.name, 'Ana Torres');
    assert.notEqual(last.data.client.id, first.data.client.id);
    assert.equal(last.data.previous.name, 'John Smith');
    assert.equal(last.data.remaining, 3);

    const details = await request(
      ctx.url,
      admin.jar,
      `/api/admin/clients/${first.data.client.id}`
    );
    assert.equal(details.data.client.status, 'completed');
    assert.equal(details.data.client.attempts.length, 3);
    assert.equal(details.data.client.progress.completed, 3);

    const returned = await request(
      ctx.url,
      admin.jar,
      `/api/admin/clients/${last.data.client.id}/return-to-pool`,
      { method: 'POST' }
    );
    assert.equal(returned.status, 200);
    assert.equal(returned.data.client.status, 'available');
    assert.equal(returned.data.client.assigned_advisor_id, null);

    const afterReturn = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    assert.ok(afterReturn.data.client);
    assert.equal(afterReturn.data.client.status, 'in_progress');

    const history = await request(
      ctx.url,
      admin.jar,
      `/api/admin/clients/${first.data.client.id}`
    );
    assert.equal(history.data.client.attempts.length, 3);
  } finally {
    await ctx.close();
  }
});

test('empty pool returns a calm message instead of an error', async () => {
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
    const maria = await login(ctx.url, 'maria', 'advisorpass1');
    const result = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    assert.equal(result.status, 200);
    assert.equal(result.data.client, null);
    assert.equal(result.data.message, 'No hay clientes disponibles.');
  } finally {
    await ctx.close();
  }
});
