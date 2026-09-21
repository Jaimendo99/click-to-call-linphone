import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractPhones, guessMapping, parseCsvBuffer } from '../src/lib/csv.js';
import { importSample, login, request, startTestServer } from './helpers.js';

const fixture = new URL('./fixtures/manatel-sample.csv', import.meta.url);

test('maps the operational extract and splits contact numbers', () => {
  const parsed = parseCsvBuffer(fs.readFileSync(fixture));
  const mapping = guessMapping(parsed.headers);

  assert.equal(mapping.name, 'CLIENTE');
  assert.equal(mapping.external_id, 'Cuenta Contrato');
  assert.deepEqual(mapping.phones, ['NUMERO', 'numeros_contacto']);
  assert.ok(mapping.extra.includes('IDENTIFICACION'));
  assert.ok(mapping.extra.includes('Direccion'));

  const samuel = parsed.rows[1];
  assert.deepEqual(extractPhones(samuel, mapping.phones), [
    '0986437417',
    '0979863622',
    '0997283604',
    '0994525838',
  ]);

  const angelica = parsed.rows[3];
  assert.deepEqual(extractPhones(angelica, mapping.phones), ['0994525838']);
});

test('imported operational rows accept per-number feedback', async () => {
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

    const imported = await importSample(ctx.url, admin.jar, fixture);
    assert.equal(imported.preview.status, 200);
    assert.equal(imported.commit.data.summary.imported, 3);
    assert.equal(imported.commit.data.summary.skippedNoPhone, 1);

    const maria = await login(ctx.url, 'maria', 'advisorpass1');
    const current = await request(ctx.url, maria.jar, '/api/advisor/current-client');
    assert.equal(current.data.client.name, 'MAGDA JANETH CEVALLOS MOREJON');
    assert.deepEqual(
      current.data.client.phones.map((phone) => phone.number),
      ['0995606551']
    );
    assert.equal(current.data.client.extra.Canton, 'MANTA');
    assert.equal(current.data.client.extra.IDENTIFICACION, '1306298140');

    const saved = await request(
      ctx.url,
      maria.jar,
      `/api/advisor/phone-numbers/${current.data.client.phones[0].id}/attempt`,
      { method: 'POST', body: { result: 'No contesta', notes: 'no contesta' } }
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.data.clientCompleted, true);
    assert.equal(saved.data.client.name, 'SAMUEL DANIEL ACOSTA MONTESDEOC');
    assert.equal(saved.data.client.phones.length, 4);

    const details = await request(
      ctx.url,
      admin.jar,
      `/api/admin/clients/${current.data.client.id}`
    );
    assert.equal(details.data.client.status, 'completed');
    assert.equal(details.data.client.phones[0].last_result, 'No contesta');
    assert.equal(details.data.client.phones[0].notes, 'no contesta');
    assert.equal(details.data.client.attempts.length, 1);
    assert.equal(details.data.client.attempts[0].result, 'No contesta');
  } finally {
    await ctx.close();
  }
});
