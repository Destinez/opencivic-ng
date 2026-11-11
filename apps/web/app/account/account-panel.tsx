'use client';

import type { SessionUser, SubmissionCard } from '@/lib/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type ErrorBody = { error?: { message: string } };

async function send<T>(path: string, init?: RequestInit) {
  const response = await fetch(`/backend${path}`, {
    ...init,
    credentials: 'include',
    headers:
      init?.body instanceof FormData
        ? init.headers
        : { 'content-type': 'application/json', ...init?.headers },
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

export function AccountPanel() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [mine, setMine] = useState<SubmissionCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const me = await send<SessionUser>('/v1/auth/me');
    if (!me.ok) {
      setUser(null);
      setMine([]);
      return;
    }
    setUser(me.data);
    const submissions = await send<{ data: SubmissionCard[] }>('/v1/submissions/mine');
    if (submissions.ok) setMine(submissions.data.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await send<SessionUser & ErrorBody>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    if (!result.ok) {
      setError(result.data.error?.message ?? 'Sign-in failed.');
      return;
    }
    await refresh();
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await send<ErrorBody>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
        ageConfirmed: form.get('ageConfirmed') === 'on',
        consent: form.get('consent') === 'on',
      }),
    });
    if (!result.ok) {
      setError(result.data.error?.message ?? 'The account was not created.');
      return;
    }
    await refresh();
  }

  async function signOut() {
    await send('/v1/auth/logout', { method: 'POST', body: '{}' });
    setInfo('Signed out.');
    await refresh();
  }

  async function removeAccount() {
    const result = await send<ErrorBody>('/v1/auth/me', { method: 'DELETE' });
    if (!result.ok) {
      setError(result.data.error?.message ?? 'The account was not deleted.');
      return;
    }
    setInfo('The account was deleted. The audit log keeps an opaque id and drops the email.');
    await refresh();
  }

  if (user === undefined) return <p>Checking your account…</p>;

  if (user) {
    return (
      <section className="card">
        <h2>{user.name}</h2>
        <p>
          {user.email} · {user.role}
        </p>
        <div className="actions">
          <Link className="button" href="/results/new">
            File an observation
          </Link>
          {user.role !== 'observer' ? (
            <Link className="button secondary" href="/review">
              Open the queue
            </Link>
          ) : null}
          {user.role === 'admin' ? (
            <Link className="button secondary" href="/admin/audit">
              Audit log
            </Link>
          ) : null}
          <button type="button" className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
          <button type="button" className="danger" onClick={() => void removeAccount()}>
            Delete account
          </button>
        </div>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {info ? <output className="status">{info}</output> : null}
        <h3>Your observations</h3>
        {mine.length === 0 ? <p>None yet.</p> : null}
        <ul>
          {mine.map((item) => (
            <li key={item.id}>
              {item.pollingUnit.name} · {item.status}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="grid-2">
      <form className="card" onSubmit={signIn} aria-labelledby="sign-in-title">
        <h2 id="sign-in-title">Sign in</h2>
        <p>Demo reviewer: chidi.bello@example.com / reviewer-demo-pass</p>
        <div className="field">
          <label htmlFor="sign-in-email">Email</label>
          <input id="sign-in-email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="sign-in-password">Password</label>
          <input
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button type="submit">Sign in</button>
      </form>
      <form className="card" onSubmit={register} aria-labelledby="register-title">
        <h2 id="register-title">Create an observer account</h2>
        <div className="field">
          <label htmlFor="register-name">Name</label>
          <input id="register-name" name="name" autoComplete="name" required minLength={2} />
        </div>
        <div className="field">
          <label htmlFor="register-email">Email</label>
          <input id="register-email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="register-password">Password</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
          />
        </div>
        <label className="check">
          <input name="ageConfirmed" type="checkbox" required />
          <span>I am 18 or older.</span>
        </label>
        <label className="check">
          <input name="consent" type="checkbox" required />
          <span>
            I agree to store my name and email so observations can be attributed. See the privacy
            note.
          </span>
        </label>
        <button type="submit">Create account</button>
      </form>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {info ? <output className="status">{info}</output> : null}
    </div>
  );
}
