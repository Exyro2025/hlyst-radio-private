'use client';

import { useState, type ReactNode } from 'react';
import { APP_TYPE_LABELS, type AppType } from '@/lib/apps';

// The /apps type filter. Wraps the server-rendered grid rather than rendering
// the cards itself: it sets data-filter on this container and CSS hides the
// cards whose own data-type doesn't match (see .bs-apps-filterwrap in
// globals.css). That keeps AppCard a server component and ships only this
// button row's worth of JS.
//
// `types` is the types actually present in the catalog (lib/apps presentTypes),
// not the full vocabulary — so every chip has at least one card behind it and
// selecting one can never produce an empty grid. There is deliberately no
// "nothing matched" state to render, because it is unreachable.
//
// Filtering is client-side over an already-rendered list; the directory is small
// enough that a route param and a server round-trip would be ceremony.
export default function AppTypeFilter({
  types,
  children,
}: {
  types: AppType[];
  children: ReactNode;
}) {
  const [active, setActive] = useState<AppType | 'all'>('all');

  // One chip is no choice at all — render the grid bare.
  if (types.length < 2) return <>{children}</>;

  const chips: Array<{ key: AppType | 'all'; label: string }> = [
    { key: 'all', label: 'All' },
    ...types.map((t) => ({ key: t, label: APP_TYPE_LABELS[t] })),
  ];

  return (
    <div className="bs-apps-filterwrap" data-filter={active}>
      <div className="bs-apps-filter" role="group" aria-label="Filter apps by type">
        {chips.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="bs-apps-chip"
            aria-pressed={active === key}
            onClick={() => setActive(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
