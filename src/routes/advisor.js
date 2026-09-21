import { Router } from 'express';
import { CALL_RESULTS } from '../lib/constants.js';
import {
  completeClientIfReady,
  getOrClaimClient,
  phoneStatusForResult,
  queueContext,
} from '../lib/claim.js';
import { requireAdvisor } from '../middleware/auth.js';

export function createAdvisorRouter(db) {
  const router = Router();
  router.use(requireAdvisor);

  function currentOrClaim(advisorId) {
    return getOrClaimClient(db, advisorId);
  }

  function sendClient(res, advisorId, client, extra = {}) {
    const queue = queueContext(db, advisorId);
    if (!client) {
      res.json({
        client: null,
        previous: queue.previous,
        remaining: queue.remaining,
        message: 'No hay clientes disponibles.',
        ...extra,
      });
      return;
    }
    res.json({
      client,
      previous: queue.previous,
      remaining: queue.remaining,
      ...extra,
    });
  }

  router.get('/current-client', (req, res) => {
    sendClient(res, req.session.user.id, currentOrClaim(req.session.user.id));
  });

  router.post('/claim-next-client', (req, res) => {
    sendClient(res, req.session.user.id, currentOrClaim(req.session.user.id));
  });

  router.post('/phone-numbers/:id/attempt', (req, res) => {
    const phoneId = Number(req.params.id);
    const result = String(req.body?.result || '').trim();
    const notes = String(req.body?.notes || '').trim().slice(0, 1000);
    const advisorId = req.session.user.id;

    if (!Number.isInteger(phoneId) || phoneId < 1) {
      res.status(400).json({ error: 'Identificador de teléfono inválido' });
      return;
    }
    if (!CALL_RESULTS.includes(result)) {
      res.status(400).json({ error: 'Debes elegir un resultado válido' });
      return;
    }

    const txn = db.transaction(() => {
      const phone = db
        .prepare(
          `SELECT p.*, c.assigned_advisor_id, c.status AS client_status
           FROM phone_numbers p
           JOIN clients c ON c.id = p.client_id
           WHERE p.id = ?`
        )
        .get(phoneId);

      if (!phone) {
        return { error: 'Teléfono no encontrado', status: 404 };
      }
      if (
        phone.client_status !== 'in_progress' ||
        phone.assigned_advisor_id !== advisorId
      ) {
        return { error: 'Este cliente no está asignado a ti', status: 403 };
      }

      db.prepare(
        `INSERT INTO call_attempts (phone_number_id, advisor_id, result, notes)
         VALUES (?, ?, ?, ?)`
      ).run(phoneId, advisorId, result, notes || null);

      db.prepare(
        `UPDATE phone_numbers
         SET status = ?,
             last_result = ?,
             notes = ?,
             last_attempt_at = datetime('now')
         WHERE id = ?`
      ).run(phoneStatusForResult(result), result, notes || null, phoneId);

      const completed = completeClientIfReady(db, phone.client_id, advisorId);
      const nextClient = getOrClaimClient(db, advisorId);

      return {
        completed,
        client: nextClient,
      };
    });

    const outcome = txn.immediate();
    if (outcome.error) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }

    sendClient(res, advisorId, outcome.client, {
      saved: true,
      clientCompleted: outcome.completed,
      message: outcome.client ? null : outcome.completed ? 'No hay clientes disponibles.' : null,
    });
  });

  return router;
}
