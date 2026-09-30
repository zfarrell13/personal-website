/** The site's editable content (src/content/site.ts). */
export interface Profile {
  name: string;
  title: string;
  location: string;
  tagline: string;
  bio: string[];
  lookingFor: string;
  photo: string;
  stats: { label: string; value: number /* 0..10 */ }[];
}

export interface Career {
  resumePdf: string;
  seasons: { role: string; company: string; start: string; end: string | 'Present'; location?: string; wins: string[]; stack?: string[] }[];
}

export interface Trophy {
  id: string;
  name: string;
  oneLiner: string;
  image: string;
  stack: string[];
  links: { label: 'PLAY' | 'VIEW' | 'CODE'; href: string }[];
  story: string[];
}

export interface Credits {
  email: string;
  links: { label: string; href: string }[];
  music: { title: string; artist: string }[];
}

/**
 * Only the title screen's fields (profile name and tagline) are required so far; the section screens
 * (Task 6) fill in the rest and make it all required.
 */
export interface SiteContent {
  profile: Pick<Profile, 'name' | 'tagline'> & Partial<Omit<Profile, 'name' | 'tagline'>>;
  career?: Career;
  trophies?: Trophy[];
  credits?: Credits;
}
