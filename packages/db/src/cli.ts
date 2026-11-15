import { readFileSync } from 'node:fs';
import { openDatabase } from './client';
import { importInecCsv } from './import-inec';
import { migrateDatabase } from './migrate';
import { clearSampleData, seedDatabase } from './seed';

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL ?? 'pglite:./.data/opencivic';

const handle = await openDatabase(databaseUrl);
try {
  if (command === 'migrate') {
    await migrateDatabase(handle.exec);
    console.log('Migrations applied.');
  } else if (command === 'seed') {
    await migrateDatabase(handle.exec);
    await seedDatabase(handle.db, { uploadDir: process.env.UPLOAD_DIR ?? './.data/uploads' });
    console.log(
      'Sample dataset seeded. Demo passwords are public. Do not expose them on the internet.',
    );
  } else if (command === 'clear-sample') {
    const result = await clearSampleData(handle.db);
    console.log(
      `Removed ${result.pollingUnits} sample polling units. Imported rows were left in place.`,
    );
  } else if (command === 'import') {
    const file = process.argv[3];
    if (!file) {
      console.error('Usage: pnpm import:inec path/to/polling-units.csv');
      process.exitCode = 1;
    } else {
      await migrateDatabase(handle.exec);
      const csv = readFileSync(file, 'utf8');
      const result = await importInecCsv(handle.db, csv);
      console.log(
        `Import finished. Rows written: ${result.insertedOrUpdated}. Rows skipped: ${result.skipped}.`,
      );
      console.log('Imported rows are not official until you confirm them against INEC.');
    }
  } else {
    console.error('Usage: cli.ts <migrate|seed|clear-sample|import> [file]');
    process.exitCode = 1;
  }
} finally {
  await handle.close();
}
