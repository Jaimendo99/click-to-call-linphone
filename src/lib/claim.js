import { CLIENT_STATUS, PHONE_STATUS } from './constants.js';
import { parseJson } from '../db.js';

export function loadClientPayload(db, client) {
  if (!client) return null;

  const phones = db
    .prepare(
      `SELECT id, number, sort_order, status, last_result, notes, last_attempt_at
       FROM phone_numbers
       WHERE client_id = ?
       ORDER BY sort_order ASC, id ASC`
    )
    .all(client.id);

  const advisor = client.assigned_advisor_id
    ? db
        .prepare('SELECT id, name, username FROM users WHERE id = ?')
        .get(client.assigned_advisor_id)
    : null;

  const completedPhones = phones.filter((phone) => phone.last_result).length;
  const campaign = client.campaign_id
    ? db
        .prepare('SELECT id, name FROM campaigns WHERE id = ?')
        .get(client.campaign_id)
    : null;

  return {
    id: client.id,
    campaign_id: client.campaign_id,
    campaign,
    external_id: client.external_id,
    name: client.name,
    status: client.status,
    assigned_advisor_id: client.assigned_advisor_id,
    assigned_at: client.assigned_at,
    completed_at: client.completed_at,
    extra: parseJson(client.extra_data),
    advisor,
    phones,
    progress: {
      completed: completedPhones,
      total: phones.length,
    },
  };
}

export function getActiveClient(db, advisorId) {
  const client = db
    .prepare(
      `SELECT * FROM clients
       WHERE assigned_advisor_id = ? AND status = ?
       LIMIT 1`
    )
    .get(advisorId, CLIENT_STATUS.IN_PROGRESS);
  return loadClientPayload(db, client);
}

function claimAvailableClient(db, advisorId) {
  const available = db
    .prepare(
      `SELECT c.id
       FROM clients c
       JOIN campaigns k ON k.id = c.campaign_id AND k.active = 1
       WHERE c.status = ?
       ORDER BY c.id ASC
       LIMIT 1`
    )
    .get(CLIENT_STATUS.AVAILABLE);

  if (!available) return null;

  const updated = db
    .prepare(
      `UPDATE clients
       SET status = ?,
           assigned_advisor_id = ?,
           assigned_at = datetime('now'),
           completed_at = NULL
       WHERE id = ? AND status = ?`
    )
    .run(
      CLIENT_STATUS.IN_PROGRESS,
      advisorId,
      available.id,
      CLIENT_STATUS.AVAILABLE
    );

  if (updated.changes !== 1) return null;

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(available.id);
  return loadClientPayload(db, client);
}

export function getOrClaimClient(db, advisorId) {
  const txn = db.transaction((id) => {
    const existing = getActiveClient(db, id);
    if (existing) return existing;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const claimed = claimAvailableClient(db, id);
      if (claimed) return claimed;
      const stillAvailable = db
        .prepare(
          `SELECT c.id
           FROM clients c
           JOIN campaigns k ON k.id = c.campaign_id AND k.active = 1
           WHERE c.status = ?
           LIMIT 1`
        )
        .get(CLIENT_STATUS.AVAILABLE);
      if (!stillAvailable) return null;
    }
    return null;
  });

  return txn.immediate(advisorId);
}

export function completeClientIfReady(db, clientId, advisorId) {
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM phone_numbers
       WHERE client_id = ? AND last_result IS NULL`
    )
    .get(clientId);

  if (pending.n > 0) return false;

  const result = db
    .prepare(
      `UPDATE clients
       SET status = ?,
           completed_at = datetime('now')
       WHERE id = ? AND assigned_advisor_id = ? AND status = ?`
    )
    .run(
      CLIENT_STATUS.COMPLETED,
      clientId,
      advisorId,
      CLIENT_STATUS.IN_PROGRESS
    );

  return result.changes === 1;
}

export function phoneStatusForResult(result) {
  return result === 'Volver a llamar' || result === 'Call Back'
    ? PHONE_STATUS.CALL_BACK
    : PHONE_STATUS.COMPLETED;
}
