'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { BoardCase } from './case-board';

export function CaseMap({ rows, onSelect }: { rows: BoardCase[]; onSelect: (id: string) => void }) {
  const node = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import('leaflet').then((L) => {
      if (disposed || !node.current) return;
      const map = L.map(node.current, { scrollWheelZoom: false, zoomAnimation: false }).setView(
        [7.5, 5.5],
        6,
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      const points = rows.filter(
        (row) => row.pollingUnit.latitude !== null && row.pollingUnit.longitude !== null,
      );
      if (points.length)
        map.fitBounds(
          L.latLngBounds(
            points.map((row) => [
              row.pollingUnit.latitude as number,
              row.pollingUnit.longitude as number,
            ]),
          ),
          { maxZoom: 13, padding: [24, 24] },
        );
      const render = () => {
        layer.clearLayers();
        const groups = new Map<string, BoardCase[]>();
        for (const row of points) {
          const point = map.project(
            [row.pollingUnit.latitude as number, row.pollingUnit.longitude as number],
            map.getZoom(),
          );
          const key = `${Math.floor(point.x / 64)}:${Math.floor(point.y / 64)}`;
          groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        for (const group of groups.values()) {
          const latitude =
            group.reduce((total, row) => total + (row.pollingUnit.latitude as number), 0) /
            group.length;
          const longitude =
            group.reduce((total, row) => total + (row.pollingUnit.longitude as number), 0) /
            group.length;
          const label =
            group.length > 1
              ? `${group.length} cases. Zoom in to separate pins.`
              : `${group[0].severity}: ${group[0].pollingUnit.name}`;
          const icon = L.divIcon({
            className: 'case-pin',
            html: `<span>${group.length > 1 ? group.length : '!'}</span>`,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          });
          const marker = L.marker([latitude, longitude], {
            icon,
            title: label,
            alt: label,
            keyboard: true,
          }).addTo(layer);
          const popup = document.createElement('div');
          popup.textContent = label;
          marker.bindPopup(popup);
          marker.on('click', () => {
            if (group.length > 1 && map.getZoom() < 18)
              map.setView([latitude, longitude], map.getZoom() + 2, { animate: false });
            else select.current(group[0].id);
          });
        }
      };
      render();
      map.on('zoomend', render);
      cleanup = () => {
        map.off('zoomend', render);
        map.remove();
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [rows]);
  return <div ref={node} className="map-frame" />;
}
