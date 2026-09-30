import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { site } from '@/content/site';

/** The link-preview card (1200×630) in the title screen's PS2 style: the name over a navy sea, the title below. */
export const alt = `${site.profile.name} · ${site.profile.title}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Russo One (OFL, see CREDITS.md) as TTF: ImageResponse can't read the woff2 that next/font serves.
const russoOne = await readFile(join(process.cwd(), 'assets/fonts/RussoOne-Regular.ttf'));

export default function OpengraphImage() {
  const { name, title } = site.profile;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 36,
          background: 'linear-gradient(180deg, #2a3f9e 0%, #0e1650 55%, #05060f 100%)',
          fontFamily: 'Russo One',
          color: '#fff',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 132,
            letterSpacing: 8,
            textShadow: '8px 8px 0 #0a1a5c',
          }}
        >
          {name.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            padding: '14px 36px',
            fontSize: 44,
            letterSpacing: 4,
            color: '#ffe16b',
            background: 'linear-gradient(180deg, rgba(34, 46, 110, 0.95), rgba(10, 14, 42, 0.97))',
            border: '4px solid #8fb4ff',
            borderRadius: 10,
            textShadow: '3px 3px 0 #3a1a00',
          }}
        >
          {title.toUpperCase()}
        </div>
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 3, color: '#b9c8f5' }}>
          FREE SURF · RIDER PROFILE · CAREER MODE · TROPHY ROOM · CREDITS
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Russo One', data: russoOne, style: 'normal', weight: 400 }] },
  );
}
