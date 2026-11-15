export const english = {
  skipContent: 'Skip to content',
  saveObservation: 'Save observation',
  savingObservation: 'Saving…',
  savedOnPhone: 'Saved on phone',
  sending: 'Sending',
  sent: 'Sent ✓',
  needsAttention: 'Needs attention',
  sendNow: 'Send now',
  caseList: 'Case list',
  showCaseMap: 'Show case map',
  hideCaseMap: 'Hide case map',
  evidencePack: 'Download evidence pack',
  claimSheet: 'Claim this sheet',
  confirmPublish: 'Confirm and publish',
  sheetOnly:
    'Photograph the sheet only, with no faces, names of voters or register pages. Location metadata is removed.',
  privacy: 'Privacy',
  downloadData: 'Download your data and photos',
  withdrawConsent: 'Withdraw evidence consent',
  restoreConsent: 'Restore evidence consent',
} as const;
export type MessageKey = keyof typeof english;
export type Locale = 'en' | 'ha' | 'yo' | 'ig' | 'pcm';
// Empty locale dictionaries fall back to English until translations are reviewed.
const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: english,
  ha: {},
  yo: {},
  ig: {},
  pcm: {},
};
export function message(key: MessageKey, locale: Locale = 'en') {
  return dictionaries[locale][key] ?? english[key];
}
