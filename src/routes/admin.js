import bcrypt from 'bcryptjs';
import { Router } from 'express';
import multer from 'multer';
import { CLIENT_STATUS, MAX_CSV_BYTES, ROLES } from '../lib/constants.js';
import { parseCsvBuffer, guessMapping, cell, extractPhones } from '../lib/csv.js';
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

function clientListQuery(db, { status, q, page, pageSize }) {
  const where = [];
  const params = [];

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
         (SELECT COUNT(*) FROM phone_numbers p WHERE p.client_id = c.id) AS phone_total,
         (SELECT COUNT(*) FROM phone_numbers p WHERE p.client_id = c.id AND p.last_result IS NOT NULL) AS phone_done
       FROM clients c
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

    const insertClient = db.prepare(
      `INSERT INTO clients (external_id, name, status, extra_data)
       VALUES (?, ?, 'available', ?)`
    );
    const insertPhone = db.prepare(
      `INSERT INTO phone_numbers (client_id, number, sort_order)
       VALUES (?, ?, ?)`
    );
    const existsExternal = db.prepare(
      `SELECT id FROM clients
       WHERE external_id = ? AND TRIM(external_id) != ''`
    );

    const summary = {
      imported: 0,
      skippedDuplicate: 0,
      skippedNoPhone: 0,
      skippedNoName: 0,
    };

    const importTxn = db.transaction(() => {
      for (const row of preview.rows) {
        const externalId = cell(row, externalIdColumn) || null;
        const name =
          cell(row, nameColumn) || externalId || '';
        if (!name) {
          summary.skippedNoName += 1;
          continue;
        }
        if (externalId) {
          const existing = existsExternal.get(externalId);
          if (existing) {
            summary.skippedDuplicate += 1;
            continue;
          }
        }

        const phones = extractPhones(row, phoneColumns);
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
          externalId,
          name.slice(0, 200),
          JSON.stringify(extra)
        );
        phones.forEach((number, index) => {
          insertPhone.run(result.lastInsertRowid, number, index + 1);
        });
        summary.imported += 1;
      }
    });

    importTxn.immediate();
    req.session.importPreview = null;
    res.json({ ok: true, summary });
  });

  router.get('/clients/summary', (_req, res) => {
    const counts = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
         FROM clients`
      )
      .get();
    res.json({
      total: counts.total || 0,
      available: counts.available || 0,
      in_progress: counts.in_progress || 0,
      completed: counts.completed || 0,
    });
  });

  router.get('/clients', (req, res) => {
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim().slice(0, 80);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));
    res.json(clientListQuery(db, { status, q, page, pageSize }));
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

    const advisor = client.assigned_advisor_id
      ? db
          .prepare('SELECT id, name, username FROM users WHERE id = ?')
          .get(client.assigned_advisor_id)
      : null;

    const phones = db
      .prepare(
        `SELECT id, number, sort_order, status, last_result, notes, last_attempt_at
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
