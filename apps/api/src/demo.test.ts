import {
  caseItems,
  discrepancyCases,
  referenceRecords,
  submissions,
  verifyAuditChain,
} from '@opencivic/db';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { seedSheetMatchDemo } from './demo';
import { testApp } from './test-utils';
it('seeds a complete fictional case and evidence pack without duplicating a repeated demo run', async () => {
  const setup = await testApp();
  try {
    const first = await seedSheetMatchDemo(setup.deps);
    expect(first.status).toBe('published');
    const counts = {
      cases: (await setup.db.select().from(discrepancyCases)).length,
      sheets: (await setup.db.select().from(submissions)).length,
      references: (await setup.db.select().from(referenceRecords)).length,
    };
    const second = await seedSheetMatchDemo(setup.deps);
    expect(second).toEqual(first);
    expect({
      cases: (await setup.db.select().from(discrepancyCases)).length,
      sheets: (await setup.db.select().from(submissions)).length,
      references: (await setup.db.select().from(referenceRecords)).length,
    }).toEqual(counts);
    const evidence = await setup.db
      .select()
      .from(caseItems)
      .where(eq(caseItems.caseId, first.caseId));
    expect(evidence).toHaveLength(2);
    const data = await (await setup.app.request(`/v1/cases/${first.caseId}`)).json();
    expect(data).toMatchObject({ official: false, status: 'published' });
    expect(JSON.stringify(data)).not.toContain('ada.okonkwo@example.com');
    const pack = await setup.app.request(`/v1/cases/${first.caseId}/evidence-pack`);
    expect(pack.status).toBe(200);
    await pack.arrayBuffer();
    expect((await verifyAuditChain(setup.db)).verified).toBe(true);
  } finally {
    await setup.close();
  }
});
