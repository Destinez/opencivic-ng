'use client';

import 'leaflet/dist/leaflet.css';
import type { LayerGroup, Map as LeafletMap } from 'leaflet';
import { useEffect, useRef, useState } from 'react';

export type MapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notice: string;
};

export function MapView({
  center,
  zoom,
  markers,
  selectedId,
  onSelect,
}: {
  center: { lat: number; lng: number };
  zoom: number;
  markers: MapMarker[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  onSelectRef.current = onSelect;

  // The map instance is created once. Marker updates are a separate effect.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;
    void import('leaflet').then((L) => {
      if (cancelled || !node.current) return;
      map = L.map(node.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      layerRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled) return;
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;
      layer.clearLayers();
      for (const marker of markers) {
        const icon = L.divIcon({
          className: `oc-pin${marker.id === selectedId ? ' is-selected' : ''}`,
          html: '<span class="oc-pin-dot"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const pin = L.marker([marker.lat, marker.lng], {
          icon,
          title: marker.name,
          keyboard: true,
        });
        pin.bindPopup(
          `<strong>${escapeHtml(marker.name)}</strong><br>${escapeHtml(marker.notice)}`,
        );
        pin.on('click', () => onSelectRef.current?.(marker.id));
        pin.addTo(layer);
      }
      if (markers.length > 0) {
        const bounds = L.latLngBounds(markers.map((item) => [item.lat, item.lng]));
        map.fitBounds(bounds.pad(0.25), { maxZoom: 15 });
      } else {
        map.setView([center.lat, center.lng], zoom);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, center.lat, center.lng, zoom, markers, selectedId]);

  return <div ref={node} className="map-frame" />;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] ?? char;
  });
}
