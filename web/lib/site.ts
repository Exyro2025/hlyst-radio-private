// Public site origin: the single source of truth for absolute URLs in metadata,
// OG/Twitter cards, robots and the sitemap.
//
// Resolved at RUNTIME. Every route emitting an absolute URL is force-dynamic, so
// the running container's env is what matters. This is deliberate: the published
// GHCR image is one generic build shared by every operator, so the domain can't
// be known at image-build time, and baking it produced localhost URLs on every
// image-based install. NEXT_PUBLIC_SITE_URL is accepted as a fallback for older
// configs. Defaults to the dev origin so local builds still produce a valid
// `metadataBase` without Next's warning.
export const SITE_URL = (
  process.env.SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'http://localhost:7700'
).replace(/\/$/, '');
