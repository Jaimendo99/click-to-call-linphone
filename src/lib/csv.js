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

function isPhoneHeader(key) {
  if (/(phone|telefono|tel|movil|celular|mobile|whatsapp|fono)/.test(key)) return true;
  return key === 'numero' || key.startsWith('numero_') || key.startsWith('numeros_');
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

  const headers = Object.keys(records[0] || {});
  if (!headers.length) {
    throw new Error('El CSV no tiene columnas');
  }
  if (headers.length > 80) {
    throw new Error('El CSV tiene demasiadas columnas');
  }

  return { headers, rows: records };
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

export function extractPhones(row, phoneColumns) {
  const seen = new Set();
  const numbers = [];
  for (const column of phoneColumns) {
    for (const token of phoneTokens(cell(row, column))) {
      const normalized = normalizePhoneNumber(token);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      numbers.push(normalized);
    }
  }
  return numbers;
}
