import { verifyAuditChain } from '../packages/db/src/audit';
import { openDatabase } from '../packages/db/src/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL for the database to verify.');
const handle = await openDatabase(url);
try {
  console.log(JSON.stringify(await verifyAuditChain(handle.db), null, 2));
} finally {
  await handle.close();
}
