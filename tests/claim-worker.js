import { parentPort, workerData } from 'node:worker_threads';
import { openDb } from '../src/db.js';
import { getOrClaimClient } from '../src/lib/claim.js';

const db = openDb(workerData.dbPath);
try {
  const client = getOrClaimClient(db, workerData.advisorId);
  parentPort.postMessage({ id: client?.id ?? null });
} catch (error) {
  parentPort.postMessage({ error: error.message });
} finally {
  db.close();
}
