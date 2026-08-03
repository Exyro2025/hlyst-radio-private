import Image from 'next/image';
import Link from 'next/link';
import EditorialReveal from '../landing/EditorialReveal';
import { AnimatedLink } from '@/components/ui/animated-link';
import { APP_TYPE_LABELS, type CommunityApp } from '@/lib/apps';

// The landing teaser for the /apps directory — a short shelf of what people have
// built against a station's API, sitting between the library section and the
// coda as the closing "and here's the ecosystem" beat.
//
// Renders NOTHING when the list is empty. A self-hosted station whose landing
// page can't reach the community catalog (or one running before the catalog
// carried any apps) must not paint an empty section with a call to action
// pointing at a directory with nothing in it.
//
// Icons only, no screenshots: this is a pointer to /apps, and a run of plates
// here would out-shout the sections above it.
export default function TheReceivers({ apps, total }: { apps: CommunityApp[]; total: number }) {
  if (apps.length === 0) return null;

  return (
    <EditorialReveal className="bs-section">
      <p className="bs-eyebrow">THE RECEIVERS</p>
      <h2>Other people build the radios.</h2>
      <p className="text-muted">
        A station speaks a plain, open API over the same origin it streams from, so a
        listener is never stuck with the player it ships. People have built their own —
        handset apps, terminal clients, bots, integrations that wire a station into
        whatever else they run.
      </p>

      <ul className="mt-6 grid list-none grid-cols-1 gap-x-6 gap-y-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => (
          <li key={app.slug} className="min-w-0">
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group flex items-center gap-3 border-t border-ink/20 pt-3 no-underline transition-colors duration-300 hover:bg-ink/[0.04]"
            >
              {app.icon ? (
                <Image
                  src={app.icon}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 flex-none object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 flex-none items-center justify-center border border-ink/20 [font-family:var(--font-mono)] text-[13px] font-bold text-muted"
                >
                  {app.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[15px] leading-tight font-bold text-ink group-hover:text-vermilion">
                  {app.name}
                </span>
                <span className="block [font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-muted uppercase">
                  {APP_TYPE_LABELS[app.type]}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-6">
        <AnimatedLink href="/apps" variant="arrow" className="bs-station-cta-link">
          {/* `total`, not apps.length — the shelf is capped, and "See all 6" next
              to exactly 6 tiles reads as though that's the whole directory. */}
          See all {total} {total === 1 ? 'app' : 'apps'}
        </AnimatedLink>
      </p>

      <p className="mt-4 max-w-[64ch] text-[14px] leading-[1.6] text-muted">
        They&rsquo;re built by their authors, not by SUB/WAVE. If you&rsquo;ve made one,{' '}
        <Link href="/apps" className="bs-link">
          add it to the directory
        </Link>
        .
      </p>
    </EditorialReveal>
  );
}
