import type { Season, SiteContent } from './types';

/**
 * The site's content: edit this file to change what the site says. Placeholder strings start with "SAMPLE"
 * (placeholder URLs carry "SAMPLE" inside them); replace them, and the files under public/site/, with your own.
 */
export const site: SiteContent = {
  profile: {
    name: 'Zach Farrell',
    title: 'Principal Product Manager',
    location: 'Wilmington, NC',
    tagline: 'Humble outperformer and oxymoron enthusiast',
    bio: [
      'Hello, I am a self-made entrepreneur and hyper-embedded in all things tech. In my free time, I like to experiment with bleeding-edge technology, surf, and compose music.',
      'Professionally, I have a fintech and AI background, currently building AI Platforms and Agent Governance for multi-billion dollar companies. I work in hyperproductive bursts with the intent to ship fast, get feedback, and iterate quickly. I care about making an impact to the bottom line.',
    ],
    lookingFor: 'Cool, down-to-earth grinders that need a 10x product manager to help them build dreams.',
    photo: '/site/photo.jpg',
    stats: [
      { label: 'Full Stack Development', value: 9 },
      { label: 'Inference Engineering', value: 10 },
      { label: 'Model Training', value: 7 },
      { label: 'Harness Engineering / Human-in-the-Loop Workflows', value: 10 },
      { label: 'User Empathy', value: 10 },
      { label: 'Patience', value: 6 },
      { label: 'Surfing', value: 4 },
      { label: 'Music Composition', value: 3 },
    ],
  },

  career: {
    resumePdf: '/site/resume-sample.pdf',
    // Any order: the page shows them newest first (seasonsNewestFirst).
    seasons: [
      {
        role: 'SAMPLE Software Engineer',
        company: 'SAMPLE Company B',
        start: '2021-08',
        end: '2023-05',
        location: 'SAMPLE Remote',
        wins: [
          'SAMPLE — replace me: shipped a feature and what it changed (a number helps).',
          'SAMPLE — replace me: a hard problem you solved.',
          'SAMPLE — replace me: something you led, taught or improved for the team.',
        ],
        stack: ['SAMPLE TypeScript', 'SAMPLE React', 'SAMPLE Node.js'],
      },
      {
        role: 'SAMPLE Senior Software Engineer',
        company: 'SAMPLE Company A',
        start: '2023-06',
        end: 'Present',
        location: 'SAMPLE City, State',
        wins: [
          'SAMPLE — replace me: the biggest thing you shipped here and its impact.',
          'SAMPLE — replace me: a performance, reliability or cost win with a number.',
          'SAMPLE — replace me: ownership, mentoring or cross-team work.',
          'SAMPLE — replace me: one more win worth a recruiter’s ten seconds.',
        ],
        stack: ['SAMPLE TypeScript', 'SAMPLE Next.js', 'SAMPLE three.js', 'SAMPLE Postgres'],
      },
      {
        role: 'SAMPLE Software Engineering Intern',
        company: 'SAMPLE Company C',
        start: '2020-06',
        end: '2020-09',
        wins: ['SAMPLE — replace me: what you built as an intern.', 'SAMPLE — replace me: what you learned or what shipped.'],
      },
    ],
  },

  trophies: [
    {
      id: 'surf-game',
      name: 'Kelly-style Surf Game',
      oneLiner: 'A PS2-era surf game in the browser: pump, carve and get barrelled on an endless peeling wave.',
      image: '/site/trophies/surf-game.svg',
      stack: ['TypeScript', 'three.js', 'WebGL 2', 'Web Audio', 'React', 'Next.js'],
      links: [
        { label: 'PLAY', href: '/surf' },
        { label: 'CODE', href: 'https://github.com/zfarrell13/personal-website' },
      ],
      story: [
        'The wave behind this whole site is a game. You drop in on a peeling reef break, left or right, and the curl chases you: pump to stay ahead of it, carve down the line, and stall on purpose to get barrelled.',
        'It is built from scratch on three.js with a custom retro renderer (low resolution, dithering, vertex snapping) for the PS2 look, a fixed-step physics model for the surfer, a procedurally animated wave mesh, and spray particles.',
        'It runs on phones with touch controls, and the site’s soundtrack follows you in: it muffles when you are inside the tube and ducks when you pause.',
      ],
    },
    {
      id: 'sample-project-1',
      name: 'SAMPLE Project One',
      oneLiner: 'SAMPLE — replace me: one line on what it is and who it is for.',
      image: '/site/trophies/sample-1.svg',
      stack: ['SAMPLE TypeScript', 'SAMPLE React'],
      links: [
        { label: 'VIEW', href: 'https://example.com/SAMPLE-project-one' },
        { label: 'CODE', href: 'https://github.com/SAMPLE/project-one' },
      ],
      story: [
        'SAMPLE — replace me: the problem, and why it was worth solving.',
        'SAMPLE — replace me: what you built, the interesting technical part, and how it turned out.',
      ],
    },
    {
      id: 'sample-project-2',
      name: 'SAMPLE Project Two',
      oneLiner: 'SAMPLE — replace me: one line on what it is and who it is for.',
      image: '/site/trophies/sample-2.svg',
      stack: ['SAMPLE Python', 'SAMPLE Postgres'],
      links: [{ label: 'CODE', href: 'https://github.com/SAMPLE/project-two' }],
      story: ['SAMPLE — replace me: the problem, what you built and the result.'],
    },
    {
      id: 'sample-project-3',
      name: 'SAMPLE Project Three',
      oneLiner: 'SAMPLE — replace me: one line on what it is and who it is for.',
      image: '/site/trophies/sample-3.svg',
      stack: ['SAMPLE Swift'],
      links: [{ label: 'VIEW', href: 'https://example.com/SAMPLE-project-three' }],
      story: ['SAMPLE — replace me: the problem, what you built and the result.'],
    },
  ],

  credits: {
    email: 'SAMPLE-replace-me@example.com',
    links: [
      { label: 'LINKEDIN', href: 'https://www.linkedin.com/in/SAMPLE-replace-me' },
      { label: 'GITHUB', href: 'https://github.com/zfarrell13' },
    ],
    // The playlist (content/tracks/tracks.json), in its order.
    music: [
      { title: 'on & on (Sudley Remix)', artist: 'Piri, Tommy Villiers, Sudley' },
      { title: 'One Day At A Time feat. Lalin St. Juste', artist: 'Nu:Tone' },
      { title: 'I Can Be Your Future', artist: 'Mozey, Shady Novelle' },
    ],
  },
};

/** Career seasons, newest first (by start month); the input is not changed. */
export function seasonsNewestFirst(seasons: readonly Season[] = site.career.seasons): Season[] {
  return [...seasons].sort((a, b) => b.start.localeCompare(a.start));
}
