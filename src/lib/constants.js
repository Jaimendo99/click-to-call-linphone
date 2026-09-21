export const ROLES = {
  ADMIN: 'admin',
  ADVISOR: 'advisor',
};

export const CLIENT_STATUS = {
  AVAILABLE: 'available',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

export const PHONE_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CALL_BACK: 'call_back',
};

export const CALL_RESULTS = [
  'No contesta',
  'Contestó',
  'Número equivocado',
  'Volver a llamar',
  'No interesado',
  'Interesado',
  'Desconectado / inválido',
];

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 50000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
