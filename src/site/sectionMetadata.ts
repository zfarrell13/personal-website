import type { Metadata } from 'next';
import { site } from '@/content/site';

// The site's share card (src/app/opengraph-image.tsx). A page's own openGraph replaces the root's wholesale,
// image included, so each section names it again.
const IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: `${site.profile.name} · ${site.profile.title}` };

/** A section page's metadata: "<Section> — <name>", for the tab and for link previews (Open Graph). */
export function sectionMetadata(section: string, description: string): Metadata {
  const title = `${section} — ${site.profile.name}`;
  return {
    title,
    description,
    openGraph: { title, description, siteName: site.profile.name, type: 'website', images: [IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [IMAGE] },
  };
}
