import path from 'node:path';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import multer from 'multer';
import { CALL_RESULTS, CLIENT_STATUS, MAX_CSV_BYTES, ROLES } from '../lib/constants.js';
import { parseCsvBuffer, guessMapping, cell, extractPhoneEntries, originHeader } from '../lib/csv.js';
import { parseJson } from '../db.js';
import { publicUser, requireAdmin } from '../middleware/auth.js';
import { validPassword, validUsername } from './auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || '').toLowerCase();
    const type = String(file.mimetype || '');
    const allowed =
      name.endsWith('.csv') ||
      type === 'text/csv' ||
      type === 'text/plain' ||
      type === 'application/csv' ||
      type === 'application/vnd.ms-excel';
    if (!allowed) {
      cb(new Error('Solo se permiten archivos CSV'));
      return;
    }
    cb(null, true);
  },
});

function campaignNameFromFilename(filename) {
  const base = path.basename(String(filename || 'Campaña')).replace(/\.csv$/i, '');
  return base.trim().slice(0, 120) || 'Campaña';
}

function campaignFilterId(db, raw) {
  if (raw != null && String(raw).trim() !== '') {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) return { error: 'Campaña inválida' };
    const row = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(id);
    if (!row) return { error: 'Campaña no encontrada' };
    return { id };
  }
  const active = db.prepare('SELECT id FROM campaigns WHERE active = 1').get();
  return { id: active?.id ?? null };
}

function clientListQuery(db, { status, q, page, pageSize, campaignId }) {
  if (campaignId == null) {
    return { total: 0, rows: [], page, pageSize };
  }

  const where = ['c.campaign_id = ?'];
  const params = [campaignId];

  if (status && Object.values(CLIENT_STATUS).includes(status)) {
    where.push('c.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(c.name LIKE ? OR IFNULL(c.external_id, "") LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM clients c ${whereSql}`)
    .get(...params).n;

  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(
      `SELECT
         c.id,
         c.external_id,
         c.name,
         c.status,
         c.assigned_advisor_id,
         c.assigned_at,
         c.completed_at,
         c.created_at,
         u.name AS advisor_name,
         u.username AS advisor_username,
         k.name AS campaign_name,
         (SELECT COUNT(*) FROM phone_numbers p WHERE p.client_id = c.id) AS phone_total,
         (SELECT COUNT(*) FROM phone_numbers p WHERE p.client_id = c.id AND p.last_result IS NOT NULL) AS phone_done
       FROM clients c
       JOIN campaigns k ON k.id = c.campaign_id
       LEFT JOIN users u ON u.id = c.assigned_advisor_id
       ${whereSql}
       ORDER BY
         CASE c.status
           WHEN 'in_progress' THEN 0
           WHEN 'available' THEN 1
           ELSE 2
         END,
         c.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  return { total, rows, page, pageSize };
}

export function createAdminRouter(db) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/users', (_req, res) => {
    const users = db
      .prepare(
        `SELECT id, name, username, role, active, created_at
         FROM users
         ORDER BY role ASC, name ASC`
      )
      .all()
      .map(publicUser);
    res.json({ users });
  });

  router.post('/users', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || '').trim();

    if (!name || name.length > 120) {
      res.status(400).json({ error: 'El nombre es obligatorio' });
      return;
    }
    if (!validUsername(username)) {
      res.status(400).json({
        error: 'El usuario debe tener de 3 a 32 caracteres: letras, números, . _ -',
      });
      return;
    }
    if (!validPassword(password)) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      return;
    }
    if (![ROLES.ADMIN, ROLES.ADVISOR].includes(role)) {
      res.status(400).json({ error: 'El rol debe ser administrador o asesor' });
      return;
    }

    try {
      const result = db
        .prepare(
          `INSERT INTO users (name, username, password_hash, role, active)
           VALUES (?, ?, ?, ?, 1)`
        )
        .run(name, username, bcrypt.hashSync(password, 10), role);
      const user = db
        .prepare(
          'SELECT id, name, username, role, active, created_at FROM users WHERE id = ?'
        )
        .get(result.lastInsertRowid);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        res.status(409).json({ error: 'Ese usuario ya existe' });
        return;
      }
      throw error;
    }
  });

  router.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'Identificador de usuario inválido' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const updates = [];
    const params = [];

    if (req.body?.name != null) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 120) {
        res.status(400).json({ error: 'El nombre es obligatorio' });
        return;
      }
      updates.push('name = ?');
      params.push(name);
    }

    if (req.body?.active != null) {
      const active = req.body.active ? 1 : 0;
      if (id === req.session.user.id && active === 0) {
        res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
        return;
      }
      updates.push('active = ?');
      params.push(active);
    }

    if (req.body?.password != null) {
      const password = String(req.body.password);
      if (!validPassword(password)) {
        res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        return;
      }
      updates.push('password_hash = ?');
      params.push(bcrypt.hashSync(password, 10));
    }

    if (!updates.length) {
      res.status(400).json({ error: 'No hay cambios para guardar' });
      return;
    }

    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db
      .prepare(
        'SELECT id, name, username, role, active, created_at FROM users WHERE id = ?'
      )
      .get(id);
    res.json({ user: publicUser(updated) });
  });

  router.post('/import/preview', (req, res, next) => {
    upload.single('file')(req, res, (error) => {
      if (error) {
        res.status(400).json({ error: error.message || 'No se pudo subir el archivo' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'El archivo CSV es obligatorio' });
        return;
      }
      try {
        const parsed = parseCsvBuffer(req.file.buffer);
        req.session.importPreview = {
          headers: parsed.headers,
          rows: parsed.rows,
          filename: req.file.originalname,
        };
        req.session.save((saveError) => {
          if (saveError) {
            next(saveError);
            return;
          }
          res.json({
            filename: req.file.originalname,
            headers: parsed.headers,
            rowCount: parsed.rows.length,
            sample: parsed.rows.slice(0, 5),
            suggestedMapping: guessMapping(parsed.headers),
          });
        });
      } catch (parseError) {
        res.status(400).json({ error: parseError.message });
      }
    });
  });

  router.post('/import/commit', (req, res) => {
    const preview = req.session.importPreview;
    if (!preview?.rows?.length) {
      res.status(400).json({ error: 'Primero previsualiza un CSV' });
      return;
    }

    const mapping = req.body?.mapping || {};
    const nameColumn = mapping.name || null;
    const externalIdColumn = mapping.external_id || null;
    const phoneColumns = Array.isArray(mapping.phones)
      ? mapping.phones.filter(Boolean)
      : [];
    const extraColumns = Array.isArray(mapping.extra)
      ? mapping.extra.filter(Boolean)
      : [];

    if (!phoneColumns.length) {
      res.status(400).json({ error: 'Selecciona al menos una columna de teléfono' });
      return;
    }
    if (!nameColumn && !externalIdColumn) {
      res.status(400).json({ error: 'Selecciona el nombre o el identificador del cliente' });
      return;
    }

    const requestedName = String(req.body?.name || '').trim();
    const campaignName = (requestedName || campaignNameFromFilename(preview.filename)).slice(0, 120);
    if (!campaignName) {
      res.status(400).json({ error: 'El nombre de la campaña es obligatorio' });
      return;
    }

    const insertClient = db.prepare(
      `INSERT INTO clients (campaign_id, external_id, name, status, extra_data)
       VALUES (?, ?, ?, 'available', ?)`
    );
    const insertPhone = db.prepare(
      `INSERT INTO phone_numbers (client_id, number, sort_order, source)
       VALUES (?, ?, ?, ?)`
    );
    const nextSort = db.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS n FROM phone_numbers WHERE client_id = ?`
    );
    const phoneExists = db.prepare(
      `SELECT id FROM phone_numbers WHERE client_id = ? AND number = ?`
    );
    const existsExternal = db.prepare(
      `SELECT id FROM clients
       WHERE campaign_id = ? AND external_id = ? AND TRIM(external_id) != ''`
    );

    const summary = {
      imported: 0,
      phonesAdded: 0,
      skippedDuplicate: 0,
      skippedNoPhone: 0,
      skippedNoName: 0,
    };
    const lineOrigin = originHeader(preview.headers);

    function addPhones(clientId, entries) {
      let order = nextSort.get(clientId).n;
      let added = 0;
      for (const entry of entries) {
        if (phoneExists.get(clientId, entry.number)) continue;
        order += 1;
        insertPhone.run(clientId, entry.number, order, entry.source || null);
        added += 1;
      }
      return added;
    }

    let campaign = null;
    const importTxn = db.transaction(() => {
      const hasActive = db.prepare('SELECT id FROM campaigns WHERE active = 1').get();
      const created = db
        .prepare('INSERT INTO campaigns (name, filename, active) VALUES (?, ?, ?)')
        .run(campaignName, preview.filename || null, hasActive ? 0 : 1);
      campaign = {
        id: Number(created.lastInsertRowid),
        name: campaignName,
        active: hasActive ? 0 : 1,
      };

      for (const row of preview.rows) {
        const externalId = cell(row, externalIdColumn) || null;
        const name =
          cell(row, nameColumn) || externalId || '';
        if (!name) {
          summary.skippedNoName += 1;
          continue;
        }
        const phones = extractPhoneEntries(row, phoneColumns, lineOrigin);
        if (externalId) {
          const existing = existsExternal.get(campaign.id, externalId);
          if (existing) {
            const added = addPhones(existing.id, phones);
            if (added) summary.phonesAdded += added;
            else summary.skippedDuplicate += 1;
            continue;
          }
        }

        if (!phones.length) {
          summary.skippedNoPhone += 1;
          continue;
        }

        const extra = {};
        for (const column of extraColumns) {
          const value = cell(row, column);
          if (value) extra[column] = value;
        }

        const result = insertClient.run(
          campaign.id,
          externalId,
          name.slice(0, 200),
          JSON.stringify(extra)
        );
        phones.forEach((entry, index) => {
          insertPhone.run(result.lastInsertRowid, entry.number, index + 1, entry.source || null);
        });
        summary.imported += 1;
      }
    });

    importTxn.immediate();
    req.session.importPreview = null;
    res.json({ ok: true, summary, campaign });
  });

  router.get('/campaigns', (_req, res) => {
    const campaigns = db
      .prepare(
        `SELECT
           k.id,
           k.name,
           k.filename,
           k.active,
           k.created_at,
           COUNT(c.id) AS total,
           COALESCE(SUM(CASE WHEN c.status = 'available' THEN 1 ELSE 0 END), 0) AS available,
           COALESCE(SUM(CASE WHEN c.status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress,
           COALESCE(SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed
         FROM campaigns k
         LEFT JOIN clients c ON c.campaign_id = k.id
         GROUP BY k.id
         ORDER BY k.active DESC, k.id DESC`
      )
      .all()
      .map((campaign) => ({
        ...campaign,
        active: campaign.active === 1,
      }));
    res.json({ campaigns });
  });

  router.get('/campaigns/:id/results', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'Identificador de campaña inválido' });
      return;
    }

    const campaign = db
      .prepare('SELECT id, name, active, created_at FROM campaigns WHERE id = ?')
      .get(id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaña no encontrada' });
      return;
    }

    const totals = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM clients WHERE campaign_id = ?) AS clients_total,
           (SELECT COUNT(DISTINCT c.id)
              FROM clients c
              JOIN phone_numbers p ON p.client_id = c.id
              JOIN call_attempts a ON a.phone_number_id = p.id
              WHERE c.campaign_id = ?) AS clients_contacted,
           (SELECT COUNT(*)
              FROM phone_numbers p
              JOIN clients c ON c.id = p.client_id
              WHERE c.campaign_id = ?) AS phones_total,
           (SELECT COUNT(DISTINCT p.id)
              FROM phone_numbers p
              JOIN clients c ON c.id = p.client_id
              JOIN call_attempts a ON a.phone_number_id = p.id
              WHERE c.campaign_id = ?) AS phones_called,
           (SELECT COUNT(*)
              FROM call_attempts a
              JOIN phone_numbers p ON p.id = a.phone_number_id
              JOIN clients c ON c.id = p.client_id
              WHERE c.campaign_id = ?) AS attempts`
      )
      .get(id, id, id, id, id);

    const counts = new Map(
      db
        .prepare(
          `SELECT a.result AS result, COUNT(*) AS count
           FROM call_attempts a
           JOIN phone_numbers p ON p.id = a.phone_number_id
           JOIN clients c ON c.id = p.client_id
           WHERE c.campaign_id = ?
           GROUP BY a.result`
        )
        .all(id)
        .map((row) => [row.result, row.count])
    );

    const known = CALL_RESULTS.filter((result) => counts.has(result));
    const extra = [...counts.keys()]
      .filter((result) => !CALL_RESULTS.includes(result))
      .sort((a, b) => a.localeCompare(b, 'es'));
    const results = [...known, ...extra].map((result) => ({
      result,
      count: counts.get(result),
    }));

    res.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        active: campaign.active === 1,
        createdAt: campaign.created_at,
      },
      clients: {
        total: totals.clients_total || 0,
        contacted: totals.clients_contacted || 0,
      },
      phones: {
        total: totals.phones_total || 0,
        called: totals.phones_called || 0,
      },
      attempts: totals.attempts || 0,
      results,
    });
  });

  router.post('/campaigns/:id/activate', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'Identificador de campaña inválido' });
      return;
    }

    const activate = db.transaction(() => {
      const campaign = db.prepare('SELECT id, name FROM campaigns WHERE id = ?').get(id);
      if (!campaign) return null;
      db.prepare('UPDATE campaigns SET active = 0 WHERE active = 1').run();
      db.prepare('UPDATE campaigns SET active = 1 WHERE id = ?').run(id);
      return campaign;
    });

    const campaign = activate();
    if (!campaign) {
      res.status(404).json({ error: 'Campaña no encontrada' });
      return;
    }
    res.json({ campaign: { id: campaign.id, name: campaign.name, active: true } });
  });

  router.get('/clients/summary', (req, res) => {
    const filter = campaignFilterId(db, req.query.campaignId);
    if (filter.error) {
      res.status(400).json({ error: filter.error });
      return;
    }
    const counts = filter.id == null
      ? { total: 0, available: 0, in_progress: 0, completed: 0 }
      : db
          .prepare(
            `SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
               SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
             FROM clients
             WHERE campaign_id = ?`
          )
          .get(filter.id);
    res.json({
      campaignId: filter.id,
      total: counts.total || 0,
      available: counts.available || 0,
      in_progress: counts.in_progress || 0,
      completed: counts.completed || 0,
    });
  });

  router.get('/clients', (req, res) => {
    const filter = campaignFilterId(db, req.query.campaignId);
    if (filter.error) {
      res.status(400).json({ error: filter.error });
      return;
    }
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim().slice(0, 80);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));
    res.json(clientListQuery(db, { status, q, page, pageSize, campaignId: filter.id }));
  });

  router.get('/clients/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'Identificador de cliente inválido' });
      return;
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    const campaign = client.campaign_id
      ? db.prepare('SELECT id, name, active FROM campaigns WHERE id = ?').get(client.campaign_id)
      : null;

    const advisor = client.assigned_advisor_id
      ? db
          .prepare('SELECT id, name, username FROM users WHERE id = ?')
          .get(client.assigned_advisor_id)
      : null;

    const phones = db
      .prepare(
        `SELECT id, number, source, sort_order, status, last_result, notes, last_attempt_at
         FROM phone_numbers
         WHERE client_id = ?
         ORDER BY sort_order ASC, id ASC`
      )
      .all(id);

    const attempts = db
      .prepare(
        `SELECT
           a.id,
           a.phone_number_id,
           a.advisor_id,
           a.result,
           a.notes,
           a.attempted_at,
           p.number AS phone_number,
           u.name AS advisor_name
         FROM call_attempts a
         JOIN phone_numbers p ON p.id = a.phone_number_id
         JOIN users u ON u.id = a.advisor_id
         WHERE p.client_id = ?
         ORDER BY a.attempted_at DESC, a.id DESC`
      )
      .all(id);

    res.json({
      client: {
        id: client.id,
        campaign_id: client.campaign_id,
        campaign: campaign
          ? { id: campaign.id, name: campaign.name, active: campaign.active === 1 }
          : null,
        external_id: client.external_id,
        name: client.name,
        status: client.status,
        assigned_advisor_id: client.assigned_advisor_id,
        assigned_at: client.assigned_at,
        completed_at: client.completed_at,
        created_at: client.created_at,
        extra: parseJson(client.extra_data),
        advisor,
        phones,
        attempts,
        progress: {
          completed: phones.filter((phone) => phone.last_result).length,
          total: phones.length,
        },
      },
    });
  });

  router.post('/clients/:id/return-to-pool', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'Identificador de cliente inválido' });
      return;
    }

    const result = db
      .prepare(
        `UPDATE clients
         SET status = ?,
             assigned_advisor_id = NULL,
             assigned_at = NULL
         WHERE id = ? AND status = ?`
      )
      .run(CLIENT_STATUS.AVAILABLE, id, CLIENT_STATUS.IN_PROGRESS);

    if (result.changes !== 1) {
      res.status(409).json({
        error: 'Solo un cliente en curso se puede devolver al pool',
      });
      return;
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    res.json({
      client: {
        id: client.id,
        name: client.name,
        status: client.status,
        assigned_advisor_id: client.assigned_advisor_id,
        assigned_at: client.assigned_at,
      },
    });
  });

  return router;
}
