export const PRODUCT_DISCLAIMER =
  'OpenCivic NG is not the Independent National Electoral Commission and does not announce official results.';

export const DATASET_DISCLAIMER =
  'Locations in this service are sample or imported data. They are not an official INEC polling-unit list.';

export const RESULTS_DISCLAIMER =
  'Unofficial crowdsourced observations. Not an INEC result and not a declaration of a winner.';

export type DatasetKind = 'sample' | 'imported';
export type CoordinateKind = 'sample-approximate' | 'imported' | 'missing';

export function datasetNotice(dataset: DatasetKind): string {
  if (dataset === 'sample') {
    return 'Sample data for demonstration. Not an official INEC polling unit.';
  }
  return 'Imported from a file you loaded. Confirm it against the current INEC list before you rely on it.';
}

export function coordinateNotice(kind: CoordinateKind): string {
  if (kind === 'sample-approximate') {
    return 'Map pin is approximate and was invented for this sample. It is not an INEC coordinate.';
  }
  if (kind === 'missing') {
    return 'No coordinates in the dataset.';
  }
  return 'Coordinates came from the imported file. OpenCivic does not certify them.';
}
