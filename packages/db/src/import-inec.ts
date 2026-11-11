import type { AppDb } from './client';
import { parseCsv, slugify } from './csv';
import { lgas, pollingUnits, states, wards } from './schema';

const EXPECTED = [
  'state_code',
  'state_name',
  'lga_code',
  'lga_name',
  'ward_code',
  'ward_name',
  'pu_code',
  'pu_name',
  'address',
  'latitude',
  'longitude',
  'registered_voters',
] as const;

export type ImportResult = { insertedOrUpdated: number; skipped: number };

function headerIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((name, position) => index.set(name.trim().toLowerCase(), position));
  const missing = EXPECTED.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new Error(`CSV is missing columns: ${missing.join(', ')}`);
  }
  return index;
}

function cell(row: string[], index: Map<string, number>, name: (typeof EXPECTED)[number]): string {
  return (row[index.get(name) ?? -1] ?? '').trim();
}

function optionalNumber(value: string, label: string, min: number, max: number): number | null {
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} is not a number between ${min} and ${max}: ${value}`);
  }
  return number;
}

export async function importInecCsv(db: AppDb, csvText: string): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
  const index = headerIndex(rows[0] ?? []);
  let insertedOrUpdated = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const puCode = cell(row, index, 'pu_code');
    if (!puCode || puCode.toUpperCase().startsWith('EXAMPLE')) {
      skipped += 1;
      continue;
    }
    const stateCode = cell(row, index, 'state_code');
    const lgaCode = cell(row, index, 'lga_code');
    const wardCode = cell(row, index, 'ward_code');
    const stateId = `import-state-${slugify(stateCode)}`;
    const lgaId = `import-lga-${slugify(stateCode)}-${slugify(lgaCode)}`;
    const wardId = `import-ward-${slugify(stateCode)}-${slugify(lgaCode)}-${slugify(wardCode)}`;
    const puId = `import-pu-${slugify(puCode)}`;
    const latitude = optionalNumber(cell(row, index, 'latitude'), 'latitude', -90, 90);
    const longitude = optionalNumber(cell(row, index, 'longitude'), 'longitude', -180, 180);
    const votersRaw = cell(row, index, 'registered_voters');
    const registeredVoters = votersRaw
      ? optionalNumber(votersRaw, 'registered_voters', 0, 1_000_000)
      : null;
    const coordinateKind = latitude !== null && longitude !== null ? 'imported' : 'missing';

    await db
      .insert(states)
      .values({
        id: stateId,
        name: cell(row, index, 'state_name'),
        code: stateCode,
        dataset: 'imported',
        latitude: null,
        longitude: null,
      })
      .onConflictDoUpdate({
        target: states.id,
        set: { name: cell(row, index, 'state_name'), code: stateCode, dataset: 'imported' },
      });

    await db
      .insert(lgas)
      .values({
        id: lgaId,
        stateId,
        name: cell(row, index, 'lga_name'),
        code: lgaCode,
        dataset: 'imported',
        latitude: null,
        longitude: null,
      })
      .onConflictDoUpdate({
        target: lgas.id,
        set: { name: cell(row, index, 'lga_name'), code: lgaCode, dataset: 'imported', stateId },
      });

    await db
      .insert(wards)
      .values({
        id: wardId,
        lgaId,
        name: cell(row, index, 'ward_name'),
        code: wardCode,
        dataset: 'imported',
        latitude: null,
        longitude: null,
      })
      .onConflictDoUpdate({
        target: wards.id,
        set: { name: cell(row, index, 'ward_name'), code: wardCode, dataset: 'imported', lgaId },
      });

    const unit = {
      wardId,
      name: cell(row, index, 'pu_name'),
      code: puCode,
      address: cell(row, index, 'address') || 'Address not included in the import file.',
      dataset: 'imported',
      coordinateKind,
      latitude,
      longitude,
      registeredVoters,
    };
    await db
      .insert(pollingUnits)
      .values({ id: puId, ...unit })
      .onConflictDoUpdate({
        target: pollingUnits.id,
        set: unit,
      });
    insertedOrUpdated += 1;
  }

  return { insertedOrUpdated, skipped };
}
