'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert">
      <h1>This page did not load</h1>
      <p>The data service may be unavailable. You can try again.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
