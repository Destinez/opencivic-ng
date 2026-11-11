import type { Metadata } from 'next';
import { AccountPanel } from './account-panel';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <>
      <p className="kicker">Your account</p>
      <h1>Account</h1>
      <p className="lede">
        An account stores a name, an email address, and a password hash so an observation can be
        attributed. New accounts are observers. Reviewers and admins are assigned, not chosen at
        registration.
      </p>
      <AccountPanel />
    </>
  );
}
