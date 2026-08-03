import Masthead from './landing/Masthead';
import StationFooter from './landing/StationFooter';
import ArticleHead from './what/ArticleHead';
import OnTheAir from './what/OnTheAir';
import PressRun from './what/PressRun';
import MeetTheVoices from './what/MeetTheVoices';
import YourStack from './what/YourStack';
import MakeARequest from './what/MakeARequest';
import BehindTheDesk from './what/BehindTheDesk';
import UnderTheHood from './what/UnderTheHood';
import Navidrome from './landing/Navidrome';
import TheReceivers from './what/TheReceivers';
import Coda from './what/Coda';
import type { ShowcaseStation } from '@/lib/stations';
import type { CommunityApp } from '@/lib/apps';

// The public landing page. A newsprint-broadsheet article introducing
// SUB/WAVE — the listener player (a live embedded mount), the AI DJ, song
// requests, the admin console, the architecture, and the music-library
// integration. Section components live under `what/` and `landing/`.
// `stations` (from the community catalog, resolved server-side) feeds the
// showcase's station tabs; omit and the demo pins to this station. `apps` (the
// capped shelf) and `appCount` (the full directory size) feed the TheReceivers
// teaser, which renders nothing when the shelf is empty — so omitting both is a
// landing page without that section, not a broken one.
export default function Landing({
  stations = [],
  apps = [],
  appCount = 0,
}: {
  stations?: ShowcaseStation[];
  apps?: CommunityApp[];
  appCount?: number;
}) {
  return (
    <div className="min-h-screen overflow-x-clip bg-bg text-ink">
      <a
        href="#landing-main"
        className="sr-only z-50 bg-bg px-4 py-2 text-[12px] font-bold tracking-[0.18em] text-ink uppercase focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:border focus:border-ink"
      >
        Skip to content
      </a>
      <Masthead />

      <main id="landing-main" className="bs-paper pt-0">
        <ArticleHead />
        <OnTheAir stations={stations} />
        <PressRun />
        <MeetTheVoices />
        <YourStack />
        <MakeARequest />
        <BehindTheDesk />
        <UnderTheHood />
        <Navidrome />
        <TheReceivers apps={apps} total={appCount} />
        <Coda />
        <StationFooter />
      </main>
    </div>
  );
}
