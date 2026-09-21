import assert from 'node:assert/strict';
import test from 'node:test';
import { importSample, login, request, sampleCsvPath, startTestServer } from './helpers.js';

test('advisors receive clients only from the active campaign', async () => {
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
        name: 'Pedro Diaz',
        username: 'pedro',
        password: 'advisorpass1',
        role: 'advisor',
      },
    });

    const firstImport = await importSample(ctx.url, admin.jar, sampleCsvPath(), 'Primera');
    const secondImport = await importSample(ctx.url, admin.jar, sampleCsvPath(), 'Segunda');
    assert.equal(firstImport.commit.data.summary.imported, 5);
    assert.equal(firstImport.commit.data.campaign.active, 1);
    assert.equal(secondImport.commit.data.summary.imported, 5);
    assert.equal(secondImport.commit.data.campaign.active, 0);

    const listed = await request(ctx.url, admin.jar, '/api/admin/campaigns');
    assert.equal(listed.data.campaigns.filter((campaign) => campaign.active).length, 1);
    assert.equal(listed.data.campaigns.find((campaign) => campaign.active).name, 'Primera');

    const maria = await login(ctx.url, 'maria', 'advisorpass1');
    const pedro = await login(ctx.url, 'pedro', 'advisorpass1');
    const mariaClient = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    const pedroClient = await request(ctx.url, pedro.jar, '/api/advisor/current-client');
    assert.equal(mariaClient.data.client.name, 'John Smith');
    assert.equal(mariaClient.data.client.campaign.name, 'Primera');
    assert.equal(pedroClient.data.client.name, 'Ana Torres');
    assert.equal(pedroClient.data.client.campaign.name, 'Primera');

    const second = listed.data.campaigns.find((campaign) => campaign.name === 'Segunda');
    const activated = await request(
      ctx.url,
      admin.jar,
      `/api/admin/campaigns/${second.id}/activate`,
      { method: 'POST' }
    );
    assert.equal(activated.status, 200);

    const stillMaria = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    assert.equal(stillMaria.data.client.id, mariaClient.data.client.id);
    assert.equal(stillMaria.data.client.campaign.name, 'Primera');

    let completed = null;
    for (const phone of mariaClient.data.client.phones) {
      completed = await request(
        ctx.url,
        maria.jar,
        `/api/advisor/phone-numbers/${phone.id}/attempt`,
        { method: 'POST', body: { result: 'No contesta' } }
      );
    }
    assert.equal(completed.data.clientCompleted, true);
    assert.equal(completed.data.client.campaign.name, 'Segunda');
    assert.equal(completed.data.client.name, 'John Smith');
    assert.notEqual(completed.data.client.id, mariaClient.data.client.id);

    const summary = await request(
      ctx.url,
      admin.jar,
      `/api/admin/clients/summary?campaignId=${firstImport.commit.data.campaign.id}`
    );
    assert.equal(summary.data.available, 3);
  } finally {
    await ctx.close();
  }
});
