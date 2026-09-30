/** The site's editable content (src/content/site.ts). Every field is required: each one is shown somewhere. */
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

export interface Trophy {
  id: string;
  name: string;
  oneLiner: string;
  image: string;
  stack: string[];
  links: TrophyLink[];
  story: string[];
}

export interface Credits {
  email: string;
  links: { label: string; href: string }[];
  music: { title: string; artist: string }[];
}

export interface SiteContent {
  profile: Profile;
  career: Career;
  trophies: Trophy[];
  credits: Credits;
}
