import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';

// Always emit ABSOLUTE strings: Next pins relative metadata URLs to
// metadataBase, which it drops on force-dynamic routes, so a relative canonical
// resolves to a localhost origin. Absolute strings are emitted verbatim.
export function absoluteUrl(path = '/'): string {
  if (!path || path === '/') return SITE_URL;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

// Next does not deep-merge nested objects like `openGraph` across the
// layout→page chain, so siteName/title are restated here rather than inherited.
//
// `title` arrives pre-branded, so it opts out of the root layout's
// `%s · SUB/WAVE` template via `absolute`, or every page doubles the brand.
// `twitter` is restated because X prefers twitter:title/description over the
// og:* tags; without it every subpage inherits the root layout's sitewide card
// (twitter:image stays global, in the root layout <head>). `siteName` defaults
// to the product name; player routes pass the operator's own station name so a
// branded install's share card isn't labelled with the software (issue #1086).
export function pageMeta({
  title,
  description,
  path,
  type = 'website',
  siteName = 'SUB/WAVE',
}: {
  title: string;
  description?: string;
  path: string;
  type?: 'website' | 'article';
  siteName?: string;
}): Metadata {
  const url = absoluteUrl(path);
  return {
    title: { absolute: title },
    ...(description ? { description } : {}),
    alternates: { canonical: url },
    openGraph: {
      title,
      ...(description ? { description } : {}),
      url,
      siteName,
      type,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      ...(description ? { description } : {}),
    },
  };
}
