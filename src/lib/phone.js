/**
 * Phone normalization and official Linphone Desktop URI construction.
 *
 * Source of truth:
 * https://wiki.linphone.org/xwiki/wiki/public/view/Linphone/URI%20Handlers%20(Desktop%20only)/
 *
 * Recommended scheme: sip-linphone:
 * Call action: ?linphone-action=call
 */

const PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const UNSAFE_CHARS = /[@?#&%<>'"\\]|[\u0000-\u001f\u007f]/;

export function normalizePhoneNumber(raw) {
  if (raw == null) return null;
  const original = String(raw).trim();
  if (!original) return null;
  if (PROTOCOL_PATTERN.test(original)) return null;
  if (UNSAFE_CHARS.test(original)) return null;

  const hasPlus = original.startsWith('+');
  const stripped = original.replace(/[\s().\-]/g, '');
  if (!stripped) return null;
  if (UNSAFE_CHARS.test(stripped)) return null;
  if (PROTOCOL_PATTERN.test(stripped)) return null;

  const digits = hasPlus ? stripped.slice(1) : stripped;
  if (!/^\d{7,15}$/.test(digits)) return null;

  // The local PBX dials the national number, for example 0996006236.
  // +593994782287 and 994782287 are the same line and must be sent as 0994782287.
  let national = null;
  if (/^5939\d{8}$/.test(digits)) national = `0${digits.slice(3)}`;
  else if (/^09\d{8}$/.test(digits)) national = digits;
  else if (/^9\d{8}$/.test(digits)) national = `0${digits}`;

  // A cédula is 10 digits and is not a line the PBX can dial.
  return /^09\d{8}$/.test(national || '') ? national : null;
}

export function buildLinphoneCallUri(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) {
    throw new Error('Número de teléfono inválido');
  }

  return `sip-linphone:${encodeURIComponent(normalized)}?linphone-action=call`;
}
