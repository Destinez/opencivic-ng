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
  electionId: string;
  capturedAt: string | null;
  receivedAt: string;
  claimedBy: string | null;
  claimedUntil: string | null;
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

export type ReferenceRecord = {
  id: string;
  electionId: string;
  pollingUnitId: string;
  source: string;
  sourceUrl: string;
  retrievedAt: string;
  imageSha256: string;
  imageUrl: string;
  accreditedVoters: number;
  rejectedBallots: number;
  partyVotes: PartyVotes;
  transcribedBy: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  notice: string;
};

export type SheetFlag = {
  id: string;
  referenceId: string | null;
  rule: string;
  field: string;
  observed: number;
  expected: number;
  severity: string;
};
export type ReviewDetail = {
  submission: SubmissionCard;
  trustLevel: number;
  reviews: Array<{
    id: number;
    reviewerId: string;
    decision: string;
    reasonCode: string | null;
    note: string;
    createdAt: string;
  }>;
  references: ReferenceRecord[];
  flags: SheetFlag[];
};

export type CaseRecord = {
  id: string;
  electionId: string;
  pollingUnit: PollingUnit;
  status: string;
  severity: string;
  summary: string;
  openedBy: string;
  confirmedBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  retractionPending: boolean;
  retractionNote: string | null;
  evidence: Array<{
    flag: SheetFlag;
    observation: Pick<
      SubmissionCard,
      'id' | 'accreditedVoters' | 'rejectedBallots' | 'partyVotes' | 'capturedAt' | 'receivedAt'
    > & { observer: string; photoSha256: string | null };
    reference:
      | (Pick<
          ReferenceRecord,
          | 'id'
          | 'accreditedVoters'
          | 'rejectedBallots'
          | 'partyVotes'
          | 'source'
          | 'sourceUrl'
          | 'retrievedAt'
          | 'imageSha256'
          | 'transcribedBy'
          | 'verifiedBy'
          | 'verifiedAt'
        > & { dataset: string })
      | null;
  }>;
  history: Array<{
    id: number;
    at: string;
    actor: string;
    action: string;
    note: string | null;
    hash: string;
  }>;
  permissions: {
    investigate: boolean;
    resolve: boolean;
    confirm: boolean;
    retract: boolean;
    comment: boolean;
  };
  comments: Array<{ id: string; body: string; at: string; author: string }>;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'observer' | 'reviewer' | 'desk' | 'admin';
};
