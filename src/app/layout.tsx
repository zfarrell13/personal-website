import type { Metadata, Viewport } from 'next';
import { Russo_One, VT323 } from 'next/font/google';
import { SiteShell } from '@/site/SiteShell';
import './globals.css';

const display = Russo_One({ weight: '400', subsets: ['latin'], variable: '--font-display' });
const mono = VT323({ weight: '400', subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Zach Farrell',
  description: 'Surf, career and projects — a PS2-style portfolio.',
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
