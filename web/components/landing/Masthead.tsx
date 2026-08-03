'use client';

import Link from 'next/link';
import { AnimatedLink } from '@/components/ui/animated-link';
import CommunityMenu from './CommunityMenu';
import { useClock } from '../../lib/hooks';

const LAUNCH_DATE = new Date('2026-01-01T00:00:00Z');

function issueNo(d: Date): number {
  return Math.max(1, Math.floor((d.getTime() - LAUNCH_DATE.getTime()) / 86400000));
}

// The volume number is the running SUB/WAVE version, which reads naturally in a
// masthead ("VOL. 1.2.0 · NO. 214") and means the page states what it is.
//
// next.config.js resolves NEXT_PUBLIC_APP_VERSION from the build arg, then
// `git describe`, then package.json — so on a working checkout it arrives as
// something like "1.2.0-33-geae57592". Only the semver head belongs here; the
// commit count and hash are build detail, and the admin console already shows
// the full string. Falls back to the original roman numeral if the env is
// absent, so the masthead never renders "VOL. ".
const VERSION = (process.env.NEXT_PUBLIC_APP_VERSION || '').split('-')[0] || 'I';

// Broadsheet-style header with proper landing-page navigation. Keeps the
// big SUB/WAVE wordmark and the double rules, drops the dateline/location/
// DJ-name strip that belonged on a newspaper but not a marketing site.
//
// No motion on the masthead — wordmark and meta row land static. The page's
// reference frame should feel like print, not a performance. (The wordmark's
// off-register ink plate settling on hover is the one exception: it only
// fires on intent, never on load.)
export default function Masthead() {
  const now = useClock();

  return (
    // bs-masthead-lift: the Community panel hangs out of the header, and
    // .bs-paper gives BOTH this header and <main> `position:relative;z-index:1`,
    // so main wins on DOM order and paints over the open dropdown. The lift has
    // to be a bs- rule rather than a Tailwind z-* utility — globals.css is
    // unlayered and therefore always beats Tailwind's @layer utilities.
    <header className="bs-paper bs-masthead-lift pt-7 !pb-4">
      <div className="bs-rule-double" />

      <div className="bs-masthead-head">
        <div className="bs-caption bs-masthead-meta flex items-center gap-[10px] text-muted">
          <span className="bs-masthead-issue text-[10px] tracking-[0.3em] uppercase">
            VOL.&nbsp;{VERSION} &nbsp;·&nbsp; NO.&nbsp;{now ? issueNo(now) : '—'}
          </span>
        </div>

        <Link
          href="/"
          aria-label="SUB/WAVE home"
          className="bs-wordmark bs-wordmark-plate bs-masthead-mark text-ink no-underline"
        >
          SUB
          <span className="bs-wordmark-slash">
            <span className="bs-wordmark-slash-glyph text-vermilion">/</span>
            <span className="bs-wordmark-disc" aria-hidden="true">
              <span className="bs-wordmark-disc-face" />
            </span>
          </span>
          WAVE
        </Link>

        <div className="bs-masthead-status flex items-center gap-2 text-[11px] font-bold tracking-[0.3em] uppercase">
          <span className="bs-live-dot" aria-hidden="true" />
          <span className="text-vermilion">ON&nbsp;AIR</span>
        </div>
      </div>

      <div className="bs-masthead-motto">
        <span aria-hidden="true">✦</span>
        <span className="bs-masthead-motto-text">
          No skips&nbsp;·&nbsp;No shuffle&nbsp;·&nbsp;Just radio
        </span>
        <span aria-hidden="true">✦</span>
      </div>

      {/* Each item carries its own trailing "·" via .bs-masthead-item::after
          rather than the dots being siblings in the flex row. As siblings they
          were independent flex items, so a wrapped row could START with a dot —
          which is exactly what the six-item nav does on a phone. Owning the dot
          means it can never outlive the word it follows, and the separators
          survive at every width instead of being dropped on mobile.

          The dot sits on the wrapper, not the <a>: AnimatedLink draws its hover
          underline with a ::before sized to the full element, so a dot inside
          the link would get underlined along with the word. */}
      <nav aria-label="Primary" className="bs-masthead-nav">
        <span className="bs-masthead-item">
          <AnimatedLink href="/listen" className="bs-masthead-link">
            Listen
          </AnimatedLink>
        </span>
        <span className="bs-masthead-item">
          <AnimatedLink href="/manual" className="bs-masthead-link">
            Manual
          </AnimatedLink>
        </span>
        <span className="bs-masthead-item">
          <AnimatedLink href="/setup" className="bs-masthead-link">
            Setup
          </AnimatedLink>
        </span>
        {/* Hidden on phones so the row stays on one line — six letterspaced
            items can't fit, and a dropdown is the worst of the six to operate
            on a touch screen anyway. Nothing is stranded: every destination
            behind it (Skills, Personas, Shows, Apps) has its own panel in the
            Back Pages footer, which is where a phone reader ends up. */}
        <span className="bs-masthead-item bs-masthead-community">
          <CommunityMenu />
        </span>
        <span className="bs-masthead-item">
          <AnimatedLink href="/news" className="bs-masthead-link">
            News
          </AnimatedLink>
        </span>
        <span className="bs-masthead-item">
          <AnimatedLink
            href="https://github.com/perminder-klair/subwave"
            variant="arrow"
            className="bs-masthead-link"
          >
            GitHub
          </AnimatedLink>
        </span>
      </nav>

      <div className="bs-rule-double" />
    </header>
  );
}
