import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <h1>That page is not here</h1>
      <p>
        <Link href="/">Back to the start</Link>
      </p>
    </>
  );
}
