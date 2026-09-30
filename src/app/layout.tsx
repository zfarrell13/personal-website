import type { Metadata, Viewport } from 'next';
import { Russo_One, VT323 } from 'next/font/google';
import { site } from '@/content/site';
import { SiteShell } from '@/site/SiteShell';
import './globals.css';

const display = Russo_One({ weight: '400', subsets: ['latin'], variable: '--font-display' });
const mono = VT323({ weight: '400', subsets: ['latin'], variable: '--font-mono' });

// From the content file, so the name, title and tagline live in one place.
const { name, title, tagline } = site.profile;
const description = `${title} · ${tagline}`;

export const metadata: Metadata = {
  // Absolute URLs for the share image (app/opengraph-image.tsx); set NEXT_PUBLIC_SITE_URL in production.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: name,
  description,
  openGraph: { title: name, description, siteName: name, type: 'website' },
  twitter: { card: 'summary_large_image', title: name, description },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#05060f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
