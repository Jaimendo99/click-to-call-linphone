import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLinphoneCallUri, normalizePhoneNumber } from '../src/lib/phone.js';

test('turns Ecuador mobiles into the national 09 number the PBX dials', () => {
  assert.equal(normalizePhoneNumber(' +593 99 111 1111 '), '0991111111');
  assert.equal(normalizePhoneNumber('(593) 991-111-111'), '0991111111');
  assert.equal(normalizePhoneNumber('+593994782287'), '0994782287');
  assert.equal(normalizePhoneNumber('0996006236'), '0996006236');
  assert.equal(normalizePhoneNumber('979863622'), '0979863622');
});

test('rejects empty, short, and injected values', () => {
  assert.equal(normalizePhoneNumber(''), null);
  assert.equal(normalizePhoneNumber('123'), null);
  assert.equal(normalizePhoneNumber('javascript:alert(1)'), null);
  assert.equal(normalizePhoneNumber('sip:user@evil'), null);
  assert.equal(normalizePhoneNumber('tel:+593991111111'), null);
  assert.equal(normalizePhoneNumber('http://example.com'), null);
  assert.equal(normalizePhoneNumber('+59399<script>'), null);
  assert.equal(normalizePhoneNumber('+59399@proxy'), null);
  assert.equal(normalizePhoneNumber('+59399%0d%0a'), null);
});

test('builds a Linphone URI with the national number', () => {
  const uri = buildLinphoneCallUri('+593994782287');
  assert.equal(uri, 'sip-linphone:0994782287?linphone-action=call');
  assert.equal(buildLinphoneCallUri('0996006236'), 'sip-linphone:0996006236?linphone-action=call');
  assert.ok(uri.startsWith('sip-linphone:'));
  assert.ok(uri.includes('linphone-action=call'));
  assert.doesNotMatch(uri, /javascript:|data:|tel:|%2B|\+/);
});

test('refuses to build a URI from an invalid number', () => {
  assert.throws(() => buildLinphoneCallUri('sip:evil@x'), /Número de teléfono inválido/);
});
