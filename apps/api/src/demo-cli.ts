import { migrateDatabase, openDatabase } from '@opencivic/db';
import { seedSheetMatchDemo } from './demo';
const handle = await openDatabase(process.env.DATABASE_URL ?? 'pglite:./.data/opencivic');
try {
  await migrateDatabase(handle.exec);
  const result = await seedSheetMatchDemo({
    db: handle.db,
    uploadDir: process.env.UPLOAD_DIR ?? './.data/uploads',
    webOrigins: ['http://localhost:3000'],
    cookieSecure: false,
  });
  console.log(`Fictional Sheet Match demo ready: http://localhost:3000/cases/${result.caseId}`);
  console.log(
    'Board: http://localhost:3000/cases. Practice upload: /samples/observer-sheet.png. Default demo passwords are public.',
  );
} finally {
  await handle.close();
}
