import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './client';
import { parseCsv, slugify } from './csv';
import { importInecCsv } from './import-inec';
import { migrateDatabase } from './migrate';
import { pollingUnits } from './schema';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, and blank lines', () => {
    const rows = parseCsv('a,b\n"hello, world","say ""hi"""\n\n1,2\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['hello, world', 'say "hi"'],
      ['1', '2'],
    ]);
  });
});

describe('slugify', () => {
  it('turns an INEC-style code into a stable id fragment', () => {
    expect(slugify('01/02/03/004')).toBe('01-02-03-004');
  });
});

describe('importInecCsv', () => {
  it('skips the example row and stores an imported unit as not part of the sample set', async () => {
    const handle = await openDatabase('pglite');
    try {
      await migrateDatabase(handle.exec);
      const csv = [
        'state_code,state_name,lga_code,lga_name,ward_code,ward_name,pu_code,pu_name,address,latitude,longitude,registered_voters',
        'EXAMPLE-LA,Lagos,EXAMPLE-IKE,Ikeja,EXAMPLE-01,Example Ward,EXAMPLE-PU,Skip me,Addr,,,,',
        '24,Lagos,08,Ikeja,01,A ward,24/08/01/001,"Ward school, Ikeja","Near the school",6.6,3.35,800',
      ].join('\n');
      const result = await importInecCsv(handle.db, csv);
      expect(result).toEqual({ insertedOrUpdated: 1, skipped: 1 });
      const rows = await handle.db
        .select()
        .from(pollingUnits)
        .where(eq(pollingUnits.dataset, 'imported'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.code).toBe('24/08/01/001');
      expect(rows[0]?.name).toBe('Ward school, Ikeja');
      expect(rows[0]?.dataset).toBe('imported');
    } finally {
      await handle.close();
    }
  });
});
