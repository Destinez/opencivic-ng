import { type PartyVotes, emptyVotes } from '@opencivic/shared';

export const DEMO_ACCOUNTS = {
  observer: {
    id: 'user-ada',
    email: 'ada.okonkwo@example.com',
    password: 'observer-demo-pass',
    name: 'Ada Okonkwo',
    role: 'observer',
  },
  reviewer: {
    id: 'user-chidi',
    email: 'chidi.bello@example.com',
    password: 'reviewer-demo-pass',
    name: 'Chidi Bello',
    role: 'reviewer',
  },
  admin: {
    id: 'user-amina',
    email: 'amina.yusuf@example.com',
    password: 'admin-demo-pass',
    name: 'Amina Yusuf',
    role: 'admin',
  },
} as const;

export const ELECTION_IDS = {
  general: 'election-2027-general',
  sample: 'election-sample-poll',
} as const;

export const ELECTION_SLUGS = {
  general: 'nigeria-2027-general',
  sample: 'sample-demonstration-poll',
} as const;

type WardSpec = { id: string; name: string; code: string; lat: number; lng: number };
type LgaSpec = {
  id: string;
  name: string;
  code: string;
  lat: number;
  lng: number;
  wards: WardSpec[];
};
type StateSpec = {
  id: string;
  name: string;
  code: string;
  lat: number;
  lng: number;
  lgas: LgaSpec[];
};

const geography: StateSpec[] = [
  {
    id: 'sample-state-lagos',
    name: 'Lagos',
    code: 'LA',
    lat: 6.5244,
    lng: 3.3792,
    lgas: [
      {
        id: 'sample-lga-lagos-ikeja',
        name: 'Ikeja',
        code: 'IKE',
        lat: 6.6018,
        lng: 3.3515,
        wards: [
          {
            id: 'sample-ward-lagos-ikeja-gra',
            name: 'Ikeja GRA',
            code: 'LA-IKE-01',
            lat: 6.588,
            lng: 3.351,
          },
          {
            id: 'sample-ward-lagos-ikeja-anifowoshe',
            name: 'Anifowoshe',
            code: 'LA-IKE-02',
            lat: 6.61,
            lng: 3.34,
          },
        ],
      },
      {
        id: 'sample-lga-lagos-etiosa',
        name: 'Eti-Osa',
        code: 'ETI',
        lat: 6.439,
        lng: 3.45,
        wards: [
          {
            id: 'sample-ward-lagos-etiosa-vi',
            name: 'Victoria Island I',
            code: 'LA-ETI-01',
            lat: 6.4281,
            lng: 3.4219,
          },
          {
            id: 'sample-ward-lagos-etiosa-lekki',
            name: 'Lekki I',
            code: 'LA-ETI-02',
            lat: 6.4474,
            lng: 3.4723,
          },
        ],
      },
      {
        id: 'sample-lga-lagos-alimosho',
        name: 'Alimosho',
        code: 'ALI',
        lat: 6.6,
        lng: 3.27,
        wards: [
          {
            id: 'sample-ward-lagos-alimosho-ipaja',
            name: 'Ipaja North',
            code: 'LA-ALI-01',
            lat: 6.612,
            lng: 3.255,
          },
          {
            id: 'sample-ward-lagos-alimosho-egbeda',
            name: 'Egbeda',
            code: 'LA-ALI-02',
            lat: 6.591,
            lng: 3.289,
          },
        ],
      },
    ],
  },
  {
    id: 'sample-state-edo',
    name: 'Edo',
    code: 'ED',
    lat: 6.335,
    lng: 5.62,
    lgas: [
      {
        id: 'sample-lga-edo-oredo',
        name: 'Oredo',
        code: 'ORD',
        lat: 6.338,
        lng: 5.62,
        wards: [
          {
            id: 'sample-ward-edo-oredo-gra',
            name: 'GRA Etete',
            code: 'ED-ORD-01',
            lat: 6.318,
            lng: 5.614,
          },
          {
            id: 'sample-ward-edo-oredo-ogbe',
            name: 'Ogbe',
            code: 'ED-ORD-02',
            lat: 6.338,
            lng: 5.633,
          },
        ],
      },
      {
        id: 'sample-lga-edo-egor',
        name: 'Egor',
        code: 'EGR',
        lat: 6.393,
        lng: 5.61,
        wards: [
          {
            id: 'sample-ward-edo-egor-uselu',
            name: 'Uselu',
            code: 'ED-EGR-01',
            lat: 6.381,
            lng: 5.609,
          },
          {
            id: 'sample-ward-edo-egor-ugbowo',
            name: 'Ugbowo',
            code: 'ED-EGR-02',
            lat: 6.405,
            lng: 5.618,
          },
        ],
      },
      {
        id: 'sample-lga-edo-ikpoba-okha',
        name: 'Ikpoba-Okha',
        code: 'IKP',
        lat: 6.29,
        lng: 5.69,
        wards: [
          {
            id: 'sample-ward-edo-ikpoba-idogbo',
            name: 'Idogbo',
            code: 'ED-IKP-01',
            lat: 6.272,
            lng: 5.701,
          },
          {
            id: 'sample-ward-edo-ikpoba-oregebeni',
            name: 'Oregbeni',
            code: 'ED-IKP-02',
            lat: 6.305,
            lng: 5.672,
          },
        ],
      },
    ],
  },
];

const offsets: Array<[number, number]> = [
  [0.004, 0.004],
  [-0.005, 0.003],
  [0.002, -0.006],
];

export type SampleState = {
  id: string;
  name: string;
  code: string;
  dataset: 'sample';
  latitude: number;
  longitude: number;
};

export type SampleLga = SampleState & { stateId: string };
export type SampleWard = SampleState & { lgaId: string };
export type SampleUnit = {
  id: string;
  wardId: string;
  name: string;
  code: string;
  address: string;
  dataset: 'sample';
  coordinateKind: 'sample-approximate';
  latitude: number;
  longitude: number;
  registeredVoters: number;
};

export function buildSampleGeography(): {
  states: SampleState[];
  lgas: SampleLga[];
  wards: SampleWard[];
  units: SampleUnit[];
} {
  const states: SampleState[] = [];
  const lgas: SampleLga[] = [];
  const wards: SampleWard[] = [];
  const units: SampleUnit[] = [];
  let n = 1;

  for (const state of geography) {
    states.push({
      id: state.id,
      name: state.name,
      code: state.code,
      dataset: 'sample',
      latitude: state.lat,
      longitude: state.lng,
    });
    for (const lga of state.lgas) {
      lgas.push({
        id: lga.id,
        stateId: state.id,
        name: lga.name,
        code: lga.code,
        dataset: 'sample',
        latitude: lga.lat,
        longitude: lga.lng,
      });
      for (const ward of lga.wards) {
        wards.push({
          id: ward.id,
          lgaId: lga.id,
          name: ward.name,
          code: ward.code,
          dataset: 'sample',
          latitude: ward.lat,
          longitude: ward.lng,
        });
        offsets.forEach(([dLat, dLng], index) => {
          const unitNumber = index + 1;
          units.push({
            id: `${ward.id}-pu-${unitNumber}`,
            wardId: ward.id,
            name: `${ward.name} sample unit ${unitNumber}`,
            code: `SAMPLE/${ward.code}/${String(unitNumber).padStart(3, '0')}`,
            address: `Sample point ${unitNumber} near ${ward.name}, ${lga.name}. Not an official address.`,
            dataset: 'sample',
            coordinateKind: 'sample-approximate',
            latitude: Number((ward.lat + dLat).toFixed(5)),
            longitude: Number((ward.lng + dLng).toFixed(5)),
            registeredVoters: 420 + ((n * 97) % 900),
          });
          n += 1;
        });
      }
    }
  }

  return { states, lgas, wards, units };
}

function votes(partial: Partial<PartyVotes>): PartyVotes {
  return { ...emptyVotes(), ...partial };
}

export type DemoSubmission = {
  id: string;
  pollingUnitId: string;
  accreditedVoters: number;
  rejectedBallots: number;
  partyVotes: PartyVotes;
  status: 'approved' | 'pending' | 'flagged';
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
  photoPlaceholder: boolean;
};

export const DEMO_SUBMISSIONS: DemoSubmission[] = [
  {
    id: 'sub-ikeja-gra-1-old',
    pollingUnitId: 'sample-ward-lagos-ikeja-gra-pu-1',
    accreditedVoters: 1,
    rejectedBallots: 0,
    partyVotes: votes({ APC: 1 }),
    status: 'approved',
    createdAt: '2027-02-20T09:00:00.000Z',
    decidedAt: '2027-02-20T09:30:00.000Z',
    note: 'Superseded by a later approved observation in the demo seed.',
    photoPlaceholder: false,
  },
  {
    id: 'sub-ikeja-gra-1',
    pollingUnitId: 'sample-ward-lagos-ikeja-gra-pu-1',
    accreditedVoters: 620,
    rejectedBallots: 14,
    partyVotes: votes({ APC: 210, PDP: 180, LP: 96, ADC: 12, NNPP: 20, others: 8 }),
    status: 'approved',
    createdAt: '2027-02-20T16:10:00.000Z',
    decidedAt: '2027-02-20T17:00:00.000Z',
    note: null,
    photoPlaceholder: false,
  },
  {
    id: 'sub-ikeja-gra-2',
    pollingUnitId: 'sample-ward-lagos-ikeja-gra-pu-2',
    accreditedVoters: 450,
    rejectedBallots: 9,
    partyVotes: votes({ APC: 70, PDP: 160, LP: 140, APGA: 15, SDP: 6, others: 4 }),
    status: 'approved',
    createdAt: '2027-02-20T16:20:00.000Z',
    decidedAt: '2027-02-20T17:05:00.000Z',
    note: null,
    photoPlaceholder: false,
  },
  {
    id: 'sub-ikeja-ani-1',
    pollingUnitId: 'sample-ward-lagos-ikeja-anifowoshe-pu-1',
    accreditedVoters: 510,
    rejectedBallots: 11,
    partyVotes: votes({ APC: 150, PDP: 90, LP: 130, YPP: 18, NNPP: 22, others: 9 }),
    status: 'approved',
    createdAt: '2027-02-20T16:30:00.000Z',
    decidedAt: '2027-02-20T17:10:00.000Z',
    note: null,
    photoPlaceholder: false,
  },
  {
    id: 'sub-oredo-gra-1',
    pollingUnitId: 'sample-ward-edo-oredo-gra-pu-1',
    accreditedVoters: 380,
    rejectedBallots: 7,
    partyVotes: votes({ APC: 40, PDP: 150, LP: 80, APGA: 30, others: 5 }),
    status: 'approved',
    createdAt: '2027-02-20T16:40:00.000Z',
    decidedAt: '2027-02-20T17:20:00.000Z',
    note: null,
    photoPlaceholder: false,
  },
  {
    id: 'sub-oredo-gra-2',
    pollingUnitId: 'sample-ward-edo-oredo-gra-pu-2',
    accreditedVoters: 410,
    rejectedBallots: 10,
    partyVotes: votes({ APC: 100, PDP: 120, LP: 60, NNPP: 40, ADC: 8, others: 6 }),
    status: 'approved',
    createdAt: '2027-02-20T16:50:00.000Z',
    decidedAt: '2027-02-20T17:25:00.000Z',
    note: null,
    photoPlaceholder: false,
  },
  {
    id: 'sub-oredo-ogbe-1',
    pollingUnitId: 'sample-ward-edo-oredo-ogbe-pu-1',
    accreditedVoters: 290,
    rejectedBallots: 5,
    partyVotes: votes({ APC: 30, PDP: 70, LP: 90, SDP: 12, others: 3 }),
    status: 'approved',
    createdAt: '2027-02-20T17:00:00.000Z',
    decidedAt: '2027-02-20T17:40:00.000Z',
    note: null,
    photoPlaceholder: false,
  },
  {
    id: 'sub-pending-vi',
    pollingUnitId: 'sample-ward-lagos-etiosa-vi-pu-1',
    accreditedVoters: 100,
    rejectedBallots: 5,
    partyVotes: votes({ APC: 80, PDP: 70, LP: 10 }),
    status: 'pending',
    createdAt: '2027-02-20T18:00:00.000Z',
    decidedAt: null,
    note: null,
    photoPlaceholder: true,
  },
  {
    id: 'sub-flagged-uselu',
    pollingUnitId: 'sample-ward-edo-egor-uselu-pu-1',
    accreditedVoters: 200,
    rejectedBallots: 0,
    partyVotes: votes({ APC: 10, PDP: 10, LP: 10 }),
    status: 'flagged',
    createdAt: '2027-02-20T15:00:00.000Z',
    decidedAt: '2027-02-20T15:30:00.000Z',
    note: 'Demo flag: the figures were incomplete against the sheet the observer described.',
    photoPlaceholder: false,
  },
];
