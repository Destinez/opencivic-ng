import type { PartyVotes } from '@opencivic/shared/parties';

export type SourceLink = { label: string; url: string };

export type DatasetFields = {
  dataset: 'sample' | 'imported';
  datasetNotice: string;
  official: false;
};

export type StateRow = DatasetFields & {
  id: string;
  name: string;
  code: string;
  latitude: number | null;
  longitude: number | null;
  pollingUnitCount: number;
};

export type AreaRow = StateRow;

export type PollingUnit = DatasetFields & {
  id: string;
  name: string;
  code: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  registeredVoters: number | null;
  coordinateKind: 'sample-approximate' | 'imported' | 'missing';
  coordinateNotice: string;
  ward: { id: string; name: string };
  lga: { id: string; name: string };
  state: { id: string; name: string };
};

export type ElectionSummary = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  summary: string;
  fictional: boolean;
  acceptsSubmissions: boolean;
  heldOn: string | null;
  notice: string;
  official: false;
};

export type ElectionDetail = ElectionSummary & {
  dates: Array<{
    id: string;
    label: string;
    occursOn: string | null;
    detail: string;
    unverified: boolean;
    sources: SourceLink[];
  }>;
  guidance: Array<{
    id: string;
    topic: string;
    title: string;
    body: string;
    bullets: string[];
    unverified: boolean;
    sources: SourceLink[];
  }>;
};

export type AggregateRow = {
  id: string;
  name: string;
  parentId: string | null;
  pollingUnitsTotal: number;
  pollingUnitsReporting: number;
  accreditedVoters: number;
  rejectedBallots: number;
  votes: PartyVotes;
};

export type SubmissionCard = {
  id: string;
  status: string;
  createdAt: string;
  accreditedVoters: number;
  rejectedBallots: number;
  partyVotes: PartyVotes;
  warnings: string[];
  decisionNote: string | null;
  hasPhoto: boolean;
  photoPlaceholder: boolean;
  official: false;
  pollingUnit: DatasetFields & {
    id: string;
    name: string;
    code: string;
    wardName: string;
    lgaName: string;
    stateName: string;
  };
  observer: { id: string; name: string } | null;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'observer' | 'reviewer' | 'admin';
};
