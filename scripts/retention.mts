import { runRetention } from '../apps/api/src/privacy';
import { migrateDatabase, openDatabase } from '../packages/db/src/index';
const handle = await openDatabase(process.env.DATABASE_URL ?? 'pglite:./.data/opencivic');
try {
  await migrateDatabase(handle.exec);
  const result = await runRetention({
    db: handle.db,
    uploadDir: process.env.UPLOAD_DIR ?? './.data/uploads',
  });
  console.log(JSON.stringify(result));
} finally {
  await handle.close();
}
