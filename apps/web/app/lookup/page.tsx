import { MapToggle } from '@/components/map-toggle';
import { ApiError, apiGet } from '@/lib/api';
import type { AreaRow, PollingUnit, StateRow } from '@/lib/types';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Polling units' };

type Search = {
  q?: string;
  state?: string;
  lga?: string;
  ward?: string;
  pu?: string;
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const q = one(params.q)?.trim() ?? '';
  const stateId = one(params.state);
  const lgaId = one(params.lga);
  const wardId = one(params.ward);
  const puId = one(params.pu);

  try {
    const states = await apiGet<{ data: StateRow[] }>('/v1/states');
    const state = states.data.find((item) => item.id === stateId);
    const lgas = stateId
      ? await apiGet<{ data: AreaRow[]; state: { id: string; name: string } }>(
          `/v1/states/${encodeURIComponent(stateId)}/lgas`,
        )
      : null;
    const lga = lgas?.data.find((item) => item.id === lgaId);
    const wards = lgaId
      ? await apiGet<{
          data: AreaRow[];
          lga: { id: string; name: string };
          state: { id: string; name: string } | null;
        }>(`/v1/lgas/${encodeURIComponent(lgaId)}/wards`)
      : null;
    const ward = wards?.data.find((item) => item.id === wardId);
    const selected = puId
      ? await apiGet<{ data: PollingUnit }>(`/v1/polling-units/${encodeURIComponent(puId)}`)
      : null;
    const markerWard = wardId || selected?.data.ward.id;
    const search =
      q.length >= 2
        ? await apiGet<{ data: PollingUnit[]; total: number }>(
            `/v1/polling-units?q=${encodeURIComponent(q)}&limit=30`,
          )
        : null;
    const wardUnits =
      !search && markerWard
        ? await apiGet<{ data: PollingUnit[] }>(
            `/v1/polling-units?wardId=${encodeURIComponent(markerWard)}&limit=100`,
          )
        : null;
    const markers = (search?.data ?? wardUnits?.data ?? [])
      .filter((unit) => unit.latitude !== null && unit.longitude !== null)
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        lat: unit.latitude as number,
        lng: unit.longitude as number,
        notice: unit.coordinateNotice,
      }));
    const center = centerFor(selected?.data, ward, lga, state);
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (stateId) query.set('state', stateId);
    if (lgaId) query.set('lga', lgaId);
    if (wardId) query.set('ward', wardId);

    return (
      <>
        <p className="kicker">Dataset browser</p>
        <h1>Polling units</h1>
        <p className="lede">
          This list is the file loaded into OpenCivic. To find the unit on your PVC, use{' '}
          <a href="https://cvr.inecnigeria.org/pu">INEC’s polling-unit portal</a>.
        </p>
        <form className="card" action="/lookup" method="get">
          <div className="field">
            <label htmlFor="q">Search polling units</label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              minLength={2}
              placeholder="Ikeja GRA"
            />
          </div>
          <button type="submit">Search</button>
        </form>
        <noscript>
          <p>The list works without JavaScript. The map needs it.</p>
        </noscript>
        <div className="lookup-layout" style={{ marginTop: 16 }}>
          <div>
            <ol className="crumbs">
              <li>
                <Link href="/lookup">States</Link>
              </li>
              {state ? (
                <li>
                  <Link href={`/lookup?state=${state.id}`}>{state.name}</Link>
                </li>
              ) : null}
              {lga && state ? (
                <li>
                  <Link href={`/lookup?state=${state.id}&lga=${lga.id}`}>{lga.name}</Link>
                </li>
              ) : null}
              {ward && state && lga ? (
                <li>
                  <Link href={`/lookup?state=${state.id}&lga=${lga.id}&ward=${ward.id}`}>
                    {ward.name}
                  </Link>
                </li>
              ) : null}
            </ol>
            {selected ? <UnitDetail unit={selected.data} /> : null}
            {search ? (
              <>
                <h2>{search.total} matches</h2>
                <UnitLinks units={search.data} query={query} />
              </>
            ) : ward ? (
              <>
                <h2>{ward.name}</h2>
                <p>
                  <span className="badge sample">{ward.datasetNotice}</span>
                </p>
                <UnitLinks units={wardUnits?.data ?? []} query={query} selectedId={puId} />
              </>
            ) : lga && wards ? (
              <>
                <h2>{lga.name}</h2>
                <PlaceLinks
                  items={wards.data}
                  hrefFor={(item) => `/lookup?state=${stateId}&lga=${lga.id}&ward=${item.id}`}
                />
              </>
            ) : state && lgas ? (
              <>
                <h2>{state.name}</h2>
                <PlaceLinks
                  items={lgas.data}
                  hrefFor={(item) => `/lookup?state=${state.id}&lga=${item.id}`}
                />
              </>
            ) : (
              <>
                <h2>States in this dataset</h2>
                <PlaceLinks items={states.data} hrefFor={(item) => `/lookup?state=${item.id}`} />
              </>
            )}
          </div>
          <MapToggle
            center={center.point}
            zoom={center.zoom}
            markers={markers}
            selectedId={puId}
            query={query.toString()}
          />
        </div>
      </>
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'The data service is unavailable.';
    return (
      <>
        <h1>Polling units</h1>
        <p className="alert" role="alert">
          {message} Start the API, or run <code>docker compose up --build</code>.
        </p>
      </>
    );
  }
}

function PlaceLinks({
  items,
  hrefFor,
}: {
  items: Array<{
    id: string;
    name: string;
    code: string;
    pollingUnitCount: number;
    dataset: string;
  }>;
  hrefFor: (item: { id: string }) => string;
}) {
  return (
    <ul className="place-list">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={hrefFor(item)}>
            <span>
              <strong>{item.name}</strong>
              <br />
              <span className="badge sample">
                {item.dataset === 'sample' ? 'Sample data' : 'Imported file'}
              </span>
            </span>
            <span>{item.pollingUnitCount} units</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function UnitLinks({
  units,
  query,
  selectedId,
}: {
  units: PollingUnit[];
  query: URLSearchParams;
  selectedId?: string;
}) {
  if (units.length === 0) return <p>No polling units in this list.</p>;
  return (
    <ul className="place-list">
      {units.map((unit) => {
        const next = new URLSearchParams(query);
        next.set('state', unit.state.id);
        next.set('lga', unit.lga.id);
        next.set('ward', unit.ward.id);
        next.set('pu', unit.id);
        return (
          <li key={unit.id}>
            <Link
              href={`/lookup?${next.toString()}`}
              aria-current={unit.id === selectedId ? 'true' : undefined}
            >
              <span>
                <strong>{unit.name}</strong>
                <br />
                {unit.code}
                <br />
                <span className="badge sample">{unit.datasetNotice}</span>
              </span>
              <span>{unit.state.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UnitDetail({ unit }: { unit: PollingUnit }) {
  return (
    <article className="card" style={{ marginBottom: 14 }}>
      <h2>{unit.name}</h2>
      <p>
        <span className="badge sample">{unit.datasetNotice}</span>
      </p>
      <p>
        <strong>Code:</strong> {unit.code}
      </p>
      <p>
        {unit.ward.name}, {unit.lga.name}, {unit.state.name}
      </p>
      <p>{unit.address}</p>
      <p>{unit.coordinateNotice}</p>
      {unit.registeredVoters ? (
        <p>Registered voters in this file: {unit.registeredVoters.toLocaleString('en-NG')}</p>
      ) : null}
      <p>
        <Link className="button" href={`/results/new?pollingUnitId=${encodeURIComponent(unit.id)}`}>
          File an unofficial observation
        </Link>
      </p>
    </article>
  );
}

function placed(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  zoom: number,
) {
  if (latitude == null || longitude == null) return null;
  return { point: { lat: latitude, lng: longitude }, zoom };
}

function centerFor(
  unit: PollingUnit | undefined,
  ward: AreaRow | undefined,
  lga: AreaRow | undefined,
  state: StateRow | undefined,
) {
  return (
    placed(unit?.latitude, unit?.longitude, 15) ??
    placed(ward?.latitude, ward?.longitude, 13) ??
    placed(lga?.latitude, lga?.longitude, 12) ??
    placed(state?.latitude, state?.longitude, 10) ?? { point: { lat: 9.082, lng: 8.6753 }, zoom: 6 }
  );
}
