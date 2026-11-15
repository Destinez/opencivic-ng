import { hasContactDetails } from '@opencivic/shared/privacy';
export function ContactWarning({ text }: { text: string }) {
  return hasContactDetails(text) ? (
    <output className="alert" aria-live="polite">
      This note may contain a phone number or email address. Remove personal contact details before
      saving.
    </output>
  ) : null;
}
