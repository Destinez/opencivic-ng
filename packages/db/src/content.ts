import { ELECTION_IDS, ELECTION_SLUGS } from './sample-data';
import type { Source } from './schema';

const inecHome: Source = { label: 'INEC', url: 'https://www.inecnigeria.org/' };
const inecEducation: Source = {
  label: 'INEC voter education',
  url: 'https://inecnigeria.org/voters/education',
};
const inecProcedure: Source = {
  label: 'INEC voting procedure PDF',
  url: 'https://inecnigeria.org/documents/voter-education/2023-Election-Procedure.pdf',
};
const inecCalendar: Source = {
  label: 'INEC election calendar',
  url: 'https://inecnigeria.org/elections/calendar',
};
const inecPuPortal: Source = {
  label: 'INEC polling-unit portal',
  url: 'https://cvr.inecnigeria.org/pu',
};
const electoralAct: Source = {
  label: 'Electoral Act 2022 (PLAC copy)',
  url: 'https://placng.org/i/wp-content/uploads/2022/02/Electoral-Act-2022.pdf',
};
const ndpc: Source = { label: 'Nigeria Data Protection Commission', url: 'https://ndpc.gov.ng/' };

export const contentElections = [
  {
    id: ELECTION_IDS.general,
    slug: ELECTION_SLUGS.general,
    name: 'Nigeria general elections, 2027',
    kind: 'general',
    fictional: false,
    acceptsSubmissions: false,
    heldOn: '2027-01-16',
    summary:
      'Informational page for the 2027 general elections. Dates below are copied from INEC’s election calendar. OpenCivic does not collect observations for this election in the seeded demo, and it does not declare winners. If INEC revises the timetable, their calendar wins.',
  },
  {
    id: ELECTION_IDS.sample,
    slug: ELECTION_SLUGS.sample,
    name: 'Sample demonstration poll',
    kind: 'demonstration',
    fictional: true,
    acceptsSubmissions: true,
    heldOn: '2027-02-20',
    summary:
      'A fictional poll used to demonstrate submission, review, and unofficial tallies. It is not an INEC election. Seeded figures are practice data, including one older approved sheet that the tally ignores in favour of the later approval.',
  },
];

export const contentDates = [
  {
    id: 'date-2027-presidential',
    electionId: ELECTION_IDS.general,
    label: 'Presidential and National Assembly election',
    occursOn: '2027-01-16',
    detail:
      'Listed as upcoming on INEC’s election calendar for nationwide presidential and National Assembly elections. Confirm the date on that page before you rely on it. INEC can revise a timetable.',
    unverified: false,
    sources: [inecCalendar],
    sortOrder: 1,
  },
  {
    id: 'date-2027-governorship',
    electionId: ELECTION_IDS.general,
    label: 'Governorship and State House of Assembly election',
    occursOn: '2027-02-06',
    detail:
      'Listed as upcoming on INEC’s election calendar. Confirm the date on that page before you rely on it.',
    unverified: false,
    sources: [inecCalendar],
    sortOrder: 2,
  },
  {
    id: 'date-2027-hours',
    electionId: ELECTION_IDS.general,
    label: 'Polling hours on INEC’s current pages',
    occursOn: null,
    detail:
      'INEC’s voter-education page and election calendar say accreditation and voting run together from 8:30am to 2:30pm, and that a person already in the queue at 2:30pm is still allowed to vote. This describes those pages, not a promise that a later circular will read the same way.',
    unverified: false,
    sources: [inecEducation, inecCalendar],
    sortOrder: 3,
  },
  {
    id: 'date-pvc-window',
    electionId: ELECTION_IDS.general,
    label: 'PVC collection window',
    occursOn: null,
    detail:
      'Not included. This dataset does not know which centres are issuing cards, or the current collection dates.',
    unverified: true,
    sources: [inecHome],
    sortOrder: 4,
  },
  {
    id: 'date-sample-open',
    electionId: ELECTION_IDS.sample,
    label: 'Sample observation day',
    occursOn: '2027-02-20',
    detail: 'Invented for the demonstration. Do not treat it as an election day.',
    unverified: false,
    sources: [],
    sortOrder: 1,
  },
];

export const contentGuidance = [
  {
    id: 'guide-what-to-bring',
    electionId: ELECTION_IDS.general,
    topic: 'what-to-bring',
    title: 'What INEC’s voter-education page says to bring',
    body: 'Taken from INEC’s voter-education page. If that page changes, the page is the authority, not this summary.',
    bullets: [
      'Bring your physical Permanent Voter Card (PVC). The page states: no PVC, no voting.',
      'Be physically present at the polling unit where you are registered. You cannot pick another unit on the day.',
      'The page does not ask for a second identity card. Do not assume some other document will replace the PVC.',
    ],
    unverified: false,
    sources: [inecEducation, inecProcedure],
    sortOrder: 1,
  },
  {
    id: 'guide-how-voting-works',
    electionId: ELECTION_IDS.general,
    topic: 'how-voting-works',
    title: 'Accreditation and voting, as INEC currently describes it',
    body: 'INEC’s voter-education page describes accreditation and voting happening together, using the Bimodal Voter Accreditation System (BVAS).',
    bullets: [
      'Join the queue at your registered polling unit.',
      'An official scans the PVC on BVAS. BVAS checks a fingerprint and, if that fails, facial recognition.',
      'Another official checks your name on the register, marks it, and issues a signed and stamped ballot paper.',
      'Mark the ballot in the cubicle, fold it vertically, and drop it in the ballot box in view of the room.',
      'You may leave, or stay at least 300 metres away to watch sorting, counting, and the announcement at the unit.',
      'The same 8:30am to 2:30pm window is repeated on INEC’s election calendar.',
    ],
    unverified: false,
    sources: [inecEducation, inecProcedure, inecCalendar],
    sortOrder: 2,
  },
  {
    id: 'guide-pvc',
    electionId: ELECTION_IDS.general,
    topic: 'pvc',
    title: 'PVC collection',
    body: 'Collection arrangements change, and this dataset does not include a current centre list or a live copy of INEC’s older FAQ about the Temporary Voter’s Card. Treat the operational detail as unverified until your INEC office confirms it.',
    bullets: [
      'INEC issues the Permanent Voter Card after registration. Without it, the voter-education page says you cannot vote.',
      'An older INEC FAQ said you present a Temporary Voter’s Card to collect the PVC, and that if you cannot find the temporary card you verify your name and complete an attestation. That FAQ URL is no longer on the current site, so this bullet is unverified.',
      'Ask at the INEC office for your local government area, and check inecnigeria.org, before you travel.',
      'To see the unit where you are registered, use INEC’s own portal. The lookup in OpenCivic is only the dataset loaded here.',
    ],
    unverified: true,
    sources: [inecHome, inecEducation, inecPuPortal],
    sortOrder: 3,
  },
  {
    id: 'guide-legal',
    electionId: ELECTION_IDS.general,
    topic: 'legal',
    title: 'What this site will not do',
    body: 'This is not legal advice. Official results are announced by INEC. A crowdsourced tally on OpenCivic is not an official declaration, and the seeded demo does not even accept observations for the 2027 elections.',
    bullets: [
      'The Electoral Act 2022 is the statute. A copy hosted by the Policy and Legal Advocacy Centre is linked for reading. The gazette is the authority if they differ.',
      'Personal data in an account is limited to a name, an email address, and a password hash, plus the observations you file. See the privacy note. The Nigeria Data Protection Act 2023 is the frame; the commission’s site is linked.',
      'Do not upload a voter register, a face, or any other person’s identity documents. A result-sheet photo is optional and is shown only to the observer who uploaded it and to reviewers.',
    ],
    unverified: false,
    sources: [electoralAct, ndpc, inecHome],
    sortOrder: 4,
  },
  {
    id: 'guide-sample',
    electionId: ELECTION_IDS.sample,
    topic: 'demonstration',
    title: 'How to read the demonstration',
    body: 'Use this poll to try the observer form and the reviewer queue. Nothing here is an INEC result.',
    bullets: [
      'Party fields are alphabetical by code, with a combined “other” line. That is not ballot order and it is not an endorsement.',
      'A reviewer approves or flags a submission. They cannot decide their own.',
      'The public tally uses the newest approved submission for each unit. Pending and flagged submissions stay off it.',
      'Coverage means “of the polling units loaded in this database”, which for the demo is a sample of Lagos and Edo, not the national list.',
    ],
    unverified: false,
    sources: [],
    sortOrder: 1,
  },
];
