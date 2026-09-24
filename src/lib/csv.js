import { parse } from 'csv-parse/sync';
import { MAX_CSV_ROWS } from './constants.js';
import { normalizePhoneNumber } from './phone.js';

function headerKey(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function isOriginHeader(key) {
  return key === 'numero_origen' || key === 'origen';
}

export function isIdentityHeader(header) {
  const key = headerKey(header);
  return (
    key === 'identificacion' ||
    key === 'identificacion_original' ||
    key === 'identificacion_scientific' ||
    key === 'cedula'
  );
}

function isPhoneHeader(key) {
  if (isOriginHeader(key)) return false;
  if (/(phone|telefono|tel|movil|celular|mobile|whatsapp|fono)/.test(key)) return true;
  return key === 'numero' || key.startsWith('numeros_');
}

function repairMojibake(value) {
  const text = String(value ?? '');
  if (!text.includes('Ã') && !text.includes('Â')) return text;
  if ([...text].some((char) => char.charCodeAt(0) > 255)) return text;
  const decoded = Buffer.from(text, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD')) return text;
  return decoded;
}

function externalIdRank(key) {
  if (key === 'cuenta_contrato') return 0;
  if (key === 'client_id' || key === 'external_id') return 1;
  if (key === 'identificacion' || key === 'cedula') return 2;
  if (key === 'codigo' || key === 'code' || key === 'id') return 3;
  return null;
}

export function parseCsvBuffer(buffer) {
  if (!buffer || !buffer.length) {
    throw new Error('El archivo CSV está vacío');
  }

  let text = buffer.toString('utf8');
  if (text.includes('\u0000')) {
    throw new Error('El CSV contiene contenido binario inválido');
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
  });

  if (!records.length) {
    throw new Error('El CSV no tiene filas de datos');
  }
  if (records.length > MAX_CSV_ROWS) {
    throw new Error(`El CSV supera el máximo de ${MAX_CSV_ROWS} filas`);
  }

  const repaired = records.map((row) => {
    const next = {};
    for (const [key, value] of Object.entries(row)) {
      const header = repairMojibake(key);
      next[header] = typeof value === 'string' ? repairMojibake(value) : value;
    }
    return next;
  });

  const headers = Object.keys(repaired[0] || {});
  if (!headers.length) {
    throw new Error('El CSV no tiene columnas');
  }
  if (headers.length > 80) {
    throw new Error('El CSV tiene demasiadas columnas');
  }

  return { headers, rows: repaired };
}

export function guessMapping(headers) {
  const phones = [];
  let name = null;
  let externalId = null;
  let externalRank = Infinity;
  const extra = [];

  for (const header of headers) {
    const key = headerKey(header);
    const rank = externalIdRank(key);
    if (!name && /^(name|full_name|client_name|nombre|cliente)$/.test(key)) {
      name = header;
    } else if (rank != null && rank < externalRank) {
      if (externalId) extra.push(externalId);
      externalId = header;
      externalRank = rank;
    } else if (rank != null) {
      extra.push(header);
    } else if (isOriginHeader(key)) {
      continue;
    } else if (isPhoneHeader(key)) {
      phones.push(header);
    } else {
      extra.push(header);
    }
  }

  return { name, external_id: externalId, phones, extra };
}

export function cell(row, column) {
  if (!column) return '';
  const value = row[column];
  if (value == null) return '';
  return String(value).trim();
}

export function phoneTokens(raw) {
  return String(raw || '')
    .split(/[|;,/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function pipeTokens(raw) {
  return String(raw || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function originHeader(headers) {
  return (headers || []).find((header) => headerKey(header) === 'numero_origen') || null;
}

export function offeringHeader(headersOrRow) {
  const keys = Array.isArray(headersOrRow)
    ? headersOrRow
    : Object.keys(headersOrRow || {});
  return keys.find((header) => headerKey(header) === 'offering_contacto') || null;
}

export function phoneSourceLabel(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/movistar/i.test(text)) return 'Movistar';
  if (/cnel/i.test(text)) return 'CNEL';
  return text.slice(0, 40);
}

function sourceForColumn(column, origin) {
  const key = headerKey(column);
  if (key === 'numero') return origin;
  if (key === 'numeros_contacto' || key.startsWith('numeros_')) return 'Contacto';
  return null;
}

export function extractPhoneEntries(row, phoneColumns, originColumn) {
  const origin = phoneSourceLabel(cell(row, originColumn));
  const offerings = pipeTokens(cell(row, offeringHeader(row)));
  let contactIndex = 0;
  const seen = new Set();
  const entries = [];
  for (const column of phoneColumns.filter((name) => !isIdentityHeader(name))) {
    const source = sourceForColumn(column, origin);
    const isContact = source === 'Contacto';
    for (const token of phoneTokens(cell(row, column))) {
      const normalized = normalizePhoneNumber(token);
      if (!normalized || seen.has(normalized)) {
        if (isContact) contactIndex += 1;
        continue;
      }
      seen.add(normalized);
      let offering = null;
      if (isContact) {
        offering = offerings[contactIndex] || null;
        contactIndex += 1;
      }
      entries.push({ number: normalized, source, offering });
    }
  }
  return entries;
}

export function extractPhones(row, phoneColumns) {
  return extractPhoneEntries(row, phoneColumns).map((entry) => entry.number);
}
