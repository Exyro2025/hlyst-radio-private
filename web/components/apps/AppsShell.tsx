import type { ReactNode } from 'react';
import Masthead from '@/components/landing/Masthead';
import StationFooter from '@/components/landing/StationFooter';

// Shared chrome for the /apps directory — same broadsheet frame as
// components/stations/StationsShell.tsx, wired up once in app/apps/layout.tsx
// so the page component is just its content.
export default function AppsShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Masthead />
      <main className="bs-paper">
        {children}
        <StationFooter />
      </main>
    </div>
  );
}
