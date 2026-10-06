/** The site's editable content (src/content/site.ts). Every field is shown somewhere; all are required except where marked optional. */
export interface Profile {
  name: string;
  title: string;
  location: string;
  tagline: string;
  bio: string[];
  lookingFor: string;
  /** Path under public/, e.g. "/site/photo.jpg". */
  photo: string;
  stats: { label: string; value: number /* 0..10 */ }[];
}

export interface Season {
  role: string;
  company: string;
  /** "YYYY-MM" (sorts as text). */
  start: string;
  end: string | 'Present';
  location?: string;
  wins: string[];
  stack?: string[];
}

export interface Career {
  /** Path under public/, e.g. "/site/resume.pdf". */
  resumePdf: string;
  seasons: Season[];
}

export interface TrophyLink {
  label: 'PLAY' | 'VIEW' | 'CODE';
  href: string;
}

/** A short silent clip on a trophy's detail card (a hardware project has no page to screenshot). */
export interface TrophyVideo {
  /** Paths under public/: an MP4 and the still shown until it plays. */
  src: string;
  poster: string;
  /** What the clip shows: its caption and its accessible name. */
  label: string;
}

export interface Trophy {
  id: string;
  name: string;
  oneLiner: string;
  image: string;
  stack: string[];
  /** May be empty (a hardware project with nothing to link to). */
  links: TrophyLink[];
  story: string[];
  /** Optional: shown on the detail card in place of the image. */
  videos?: TrophyVideo[];
}

export interface Credits {
  email: string;
  links: { label: string; href: string }[];
}

export interface SiteContent {
  /** The line under the name on the title menu. */
  homeTagline: string;
  profile: Profile;
  career: Career;
  trophies: Trophy[];
  credits: Credits;
}
