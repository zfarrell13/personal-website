import type { Metadata } from 'next';
import { site } from '@/content/site';

/** A section page's metadata: "<Section> — <name>", for the tab and for link previews (Open Graph). */
export function sectionMetadata(section: string, description: string): Metadata {
  const title = `${section} — ${site.profile.name}`;
  return { title, description, openGraph: { title, description, siteName: site.profile.name, type: 'website' } };
}
