import assert from 'node:assert/strict';
import test from 'node:test';
import { importSample, login, request, startTestServer } from './helpers.js';

test('campaign results count contacted clients, called numbers, and selected outcomes', async () => {
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

    const imported = await importSample(ctx.url, admin.jar, undefined, 'Base norte');
    const campaignId = imported.commit.data.campaign.id;
    const maria = await login(ctx.url, 'maria', 'advisorpass1');
    const current = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    const phones = current.data.client.phones;
    assert.equal(phones.length, 3);

    const first = await request(ctx.url, maria.jar, `/api/advisor/phone-numbers/${phones[0].id}/attempt`, {
      method: 'POST',
      body: { result: 'Volver a llamar' },
    });
    assert.equal(first.status, 200);
    const second = await request(ctx.url, maria.jar, `/api/advisor/phone-numbers/${phones[0].id}/attempt`, {
      method: 'POST',
      body: { result: 'Contestó' },
    });
    assert.equal(second.status, 200);
    const third = await request(ctx.url, maria.jar, `/api/advisor/phone-numbers/${phones[1].id}/attempt`, {
      method: 'POST',
      body: { result: 'No contesta' },
    });
    assert.equal(third.status, 200);
    const fourth = await request(ctx.url, maria.jar, `/api/advisor/phone-numbers/${phones[2].id}/attempt`, {
      method: 'POST',
      body: { result: 'Interesado' },
    });
    assert.equal(fourth.status, 200);

    const dashboard = await request(ctx.url, admin.jar, `/api/admin/campaigns/${campaignId}/results`);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.campaign.name, 'Base norte');
    assert.equal(dashboard.data.clients.total, 5);
    assert.equal(dashboard.data.clients.contacted, 1);
    assert.equal(dashboard.data.phones.total, 11);
    assert.equal(dashboard.data.phones.called, 3);
    assert.equal(dashboard.data.attempts, 4);
    assert.deepEqual(
      dashboard.data.results.map((item) => [item.result, item.count]),
      [
        ['No contesta', 1],
        ['Contestó', 1],
        ['Volver a llamar', 1],
        ['Interesado', 1],
      ]
    );

    const other = await importSample(ctx.url, admin.jar, undefined, 'Base sur');
    const empty = await request(
      ctx.url,
      admin.jar,
      `/api/admin/campaigns/${other.commit.data.campaign.id}/results`
    );
    assert.equal(empty.data.clients.contacted, 0);
    assert.equal(empty.data.phones.called, 0);
    assert.equal(empty.data.attempts, 0);
    assert.deepEqual(empty.data.results, []);

    const denied = await request(ctx.url, maria.jar, `/api/admin/campaigns/${campaignId}/results`);
    assert.equal(denied.status, 403);

    const missing = await request(ctx.url, admin.jar, '/api/admin/campaigns/9999/results');
    assert.equal(missing.status, 404);
  } finally {
    await ctx.close();
  }
});
