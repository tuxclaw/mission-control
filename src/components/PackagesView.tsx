import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Package } from 'lucide-react';
import type { PackagesData } from '../types';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? '';

export function PackagesView() {
  const [data, setData] = useState<PackagesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPackages = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${VITALS_API}/api/packages`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PackagesData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load packages');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPackages = useCallback(async () => {
    setRefreshing(true);
    try {
      setError(null);
      const res = await fetch(`${VITALS_API}/api/packages/refresh`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PackagesData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh packages');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const lastUpdated = data?.lastUpdated
    ? new Date(data.lastUpdated).toLocaleString()
    : null;

  const totalPkgs = data?.groups.reduce((sum, g) => sum + g.packages.length, 0) ?? 0;
  const currentCount = data?.groups.reduce(
    (sum, g) => sum + g.packages.filter(p => p.status === 'current').length, 0
  ) ?? 0;
  const outdatedCount = data?.groups.reduce(
    (sum, g) => sum + g.packages.filter(p => p.status === 'outdated').length, 0
  ) ?? 0;

  return (
    <div className="board flex-1 flex flex-col min-h-0" role="tabpanel" id="panel-packages">
      {/* Header */}
      <div className="board__header flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h2 className="board__title text-lg font-semibold">TuxLinux Packages</h2>
          <p className="board__subtitle text-xs mt-1">
            {lastUpdated ? `Last updated: ${lastUpdated}` : 'Package versions from Fedora repos'}
            {totalPkgs > 0 && (
              <span className="pkg-stats">
                {' '}&middot; {totalPkgs} packages &middot;{' '}
                <span className="pkg-text--current">{currentCount} current</span>
                {outdatedCount > 0 && (
                  <>{' '}&middot; <span className="pkg-text--outdated">{outdatedCount} outdated</span></>
                )}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="board__action-btn flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
          onClick={refreshPackages}
          disabled={refreshing}
          aria-label="Refresh package data"
        >
          <RefreshCw size={14} className={refreshing ? 'pkg-spin' : ''} aria-hidden="true" />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Content */}
      <div className="pkg-content flex-1 min-h-0 overflow-auto px-6 py-4">
        {loading && (
          <div className="pkg-loading">
            <Package size={24} className="pkg-spin" aria-hidden="true" />
            <p>Loading package data...</p>
          </div>
        )}

        {error && !loading && (
          <div className="pkg-error">
            <p>Failed to load packages: {error}</p>
            <button type="button" className="board__action-btn px-3 py-2 rounded-lg text-xs font-medium" onClick={fetchPackages}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <div className="pkg-table-wrap">
            <table className="pkg-table">
              <thead>
                <tr>
                  <th className="pkg-th pkg-th--name">Package</th>
                  <th className="pkg-th pkg-th--version">Rawhide</th>
                  <th className="pkg-th pkg-th--version">Fedora 43</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((group) => (
                  <GroupRows key={group.name} name={group.name} packages={group.packages} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && data && data.groups.length === 0 && (
          <div className="pkg-loading">
            <Package size={24} aria-hidden="true" style={{ opacity: 0.4 }} />
            <p>No packages found.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupRows({ name, packages }: { name: string; packages: PackagesData['groups'][0]['packages'] }) {
  return (
    <>
      <tr className="pkg-group-row">
        <td colSpan={3} className="pkg-group-cell">{name}</td>
      </tr>
      {packages.map((pkg) => (
        <tr key={pkg.name} className="pkg-row">
          <td className="pkg-td pkg-td--name">{pkg.name}</td>
          <td className={`pkg-td pkg-td--version ${versionClass(pkg.rawhide, pkg.status)}`}>
            {pkg.rawhide}
          </td>
          <td className={`pkg-td pkg-td--version ${versionClass(pkg.stable, pkg.status)}`}>
            {pkg.stable}
          </td>
        </tr>
      ))}
    </>
  );
}

function versionClass(version: string, status: string): string {
  if (version === '--') return 'pkg-text--missing';
  if (status === 'beta') return 'pkg-text--beta';
  if (status === 'current') return 'pkg-text--current';
  return '';
}
