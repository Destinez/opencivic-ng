'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MapMarker } from './map-view';

const MapView = dynamic(() => import('./map-view').then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <p>Loading the map…</p>,
});

export function MapToggle({
  center,
  zoom,
  markers,
  selectedId,
  query,
}: {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarker[];
  selectedId?: string;
  query: string;
}) {
  const router = useRouter();
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 960px)');
    const apply = () => setDesktop(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  const shown = desktop || open;
  return (
    <div className="map-panel card">
      <h2>Map</h2>
      <p>
        Pins are loaded for a ward or a search, not for a whole state, so a larger import stays
        usable on a phone. Scroll stays on the page; the map does not capture the wheel.
      </p>
      {!desktop ? (
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide map' : 'Show map'}
        </button>
      ) : null}
      {shown ? (
        <section aria-label="Map of polling units in the current list">
          <MapView
            center={center}
            zoom={zoom}
            markers={markers}
            selectedId={selectedId}
            onSelect={(id) => {
              const params = new URLSearchParams(query);
              params.set('pu', id);
              router.push(`/lookup?${params.toString()}`);
            }}
          />
        </section>
      ) : (
        <p>The map stays off until you open it, so it does not use data in the background.</p>
      )}
      <p>Map tiles © OpenStreetMap contributors. Pins come from this dataset, not from INEC.</p>
    </div>
  );
}
