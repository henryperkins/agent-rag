import { useEffect, useState } from 'react';

type ServiceCounters = {
  documentCount?: { usage: number; quota?: number | null };
  indexesCount?: { usage: number; quota?: number | null };
  indexersCount?: { usage: number; quota?: number | null };
  dataSourcesCount?: { usage: number; quota?: number | null };
  storageSize?: { usage: number; quota?: number | null };
  synonymMaps?: { usage: number; quota?: number | null };
  skillsetCount?: { usage: number; quota?: number | null };
  vectorIndexSize?: { usage: number; quota?: number | null };
};

interface SearchStatsPayload {
  service?: { counters?: ServiceCounters };
  index?: { documentCount: number; storageSize: number; vectorIndexSize: number };
  summary?: { indexes: Array<{ name: string; documentCount: number; storageSize: number; vectorIndexSize: number }> };
  error?: string;
}

export function AdminStatsCard() {
  const [stats, setStats] = useState<SearchStatsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(`${(import.meta.env.VITE_API_BASE ?? __API_BASE__) as string}/admin/telemetry`, {
          signal: controller.signal
        });
        if (!res.ok) {
          return; // Hide silently in prod or when route not exposed
        }
        const data = (await res.json()) as { searchStats?: SearchStatsPayload };
        if (data?.searchStats) setStats(data.searchStats);
      } catch (e: any) {
        setError(e?.message ?? '');
      }
    };
    load();
    return () => controller.abort();
  }, []);

  if (!stats || stats.error) {
    return null;
  }

  const svc = stats.service?.counters ?? {};
  const idx = stats.index;

  const row = (label: string, value?: number, unit?: string) => (
    <div className="admin-row">
      <span className="admin-label">{label}</span>
      <span className="admin-value">{value !== undefined ? value.toLocaleString() : '—'}{unit ?? ''}</span>
    </div>
  );

  return (
    <div className="panel">
      <h3>Search Service Stats</h3>
      {row('Docs (service)', svc.documentCount?.usage)}
      {row('Indexes', svc.indexesCount?.usage)}
      {row('Storage (svc bytes)', svc.storageSize?.usage)}
      {row('Vector mem (svc bytes)', svc.vectorIndexSize?.usage)}
      <hr />
      <h4>Active Index</h4>
      {row('Docs', idx?.documentCount)}
      {row('Storage (bytes)', idx?.storageSize)}
      {row('Vector mem (bytes)', idx?.vectorIndexSize)}
      {error ? <div className="admin-error">{error}</div> : null}
    </div>
  );
}

