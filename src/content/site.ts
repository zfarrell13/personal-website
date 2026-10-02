import type { Season, SiteContent } from './types';

/**
 * The site's content: edit this file to change what the site says. Placeholder strings start with "SAMPLE"
 * (placeholder URLs carry "SAMPLE" inside them); replace them, and the files under public/site/, with your own.
 */
export const site: SiteContent = {
  homeTagline: 'Principal PM shipping AI platforms, music tech, and one very retro surf game',
  profile: {
    name: 'Zach Farrell',
    title: 'Principal Product Manager',
    location: 'Wilmington, NC',
    tagline: 'Humble outperformer and irony enthusiast',
    bio: [
      'I am a self-made entrepreneur and hyper-embedded in all things tech. In my free time, I like to experiment with bleeding-edge technology, surf, and compose music.',
      'Professionally, I have a fintech and AI background, currently building the AI Platform and agent governance tools for Vantaca. I work in hyperproductive bursts with the intent to ship fast, get feedback, and iterate quickly. I care about making an impact to the bottom line.',
    ],
    lookingFor: 'Cool, down-to-earth grinders that need a 10x product manager and SWE to help them build dreams.',
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
    resumePdf: '/site/Zach_Farrell_Resume.pdf',
    // Any order: the page shows them newest first (seasonsNewestFirst).
    seasons: [
      {
        role: 'Principal Product Manager',
        company: 'Vantaca',
        start: '2026-04',
        end: 'Present',
        wins: [
          'AI Platform: Leading the AI platform that brings LLM-powered agents into Vantaca’s community association management software — the shared foundation for model access, inference, evaluation and observability that every product team builds on.',
          'Agent Governance: Defining how AI agents are allowed to act on behalf of customers — policies, permissions, guardrails, audit trails and human-in-the-loop approvals — so agents can take real actions safely at enterprise scale.',
          'User & Agent Management: Building unified identity, roles and access control for both people and AI agents, so customers can see, control and trust exactly what every user and every agent can do across their organization.',
        ],
        stack: ['LLMs', 'AI Agents', 'Inference', 'Agent Governance', 'Identity & Access', 'Human-in-the-Loop'],
      },
      {
        role: 'Senior Technical Product Manager – Platform',
        company: 'Quantum Financial Technologies',
        start: '2024-01',
        end: '2026-04',
        wins: [
          'Decisioning Engine Platform (0→1): Solely architected, rebuilt, and tested the company’s core loan origination system and credit decisioning engine end-to-end — including underwriting logic, risk scoring models, and ML-driven inference pipelines — eliminating a $2M/year vendor dependency and single-handedly driving the company to breakeven.',
          'Credit Strategy & Roadmap: Defined and executed the product roadmap for the lending platform, owning underwriting thresholds, loss modeling, risk tolerance rules, and cap structures across multiple loan products in partnership with data science and finance teams.',
          'Underwriting Automation: Built automated credit workflows that replaced manual review processes with rules-based decisioning and intelligent escalation paths, reducing underwriting time and improving consistency at scale.',
          'Portfolio Performance: Monitored portfolio health metrics including loss rates, delinquency, repayment behavior, and model calibration — implementing guardrails that reduced adverse selection and improved risk-adjusted returns.',
          'Lending Partnerships: Led technical integrations with lending partners (SoFi, LendingTree), navigating complex banking networks to expand product distribution and generate $3M in incremental revenue.',
          'Cross-Functional Leadership: Drove collaboration across engineering, data science, finance, operations, and compliance, aligning teams on credit strategy and product priorities.',
        ],
        stack: ['Loan Origination', 'Credit Decisioning', 'Risk Scoring', 'ML Inference', 'Underwriting Automation'],
      },
      {
        role: 'Founder & Product Lead',
        company: 'Audialmusic.ai',
        start: '2024-08',
        end: 'Present',
        wins: [
          'Solo Technical Build: Built and launched a consumer platform from scratch, scaling to thousands of monthly active users with zero downtime — managing technical architecture, ML model development, data pipelines, and go-to-market independently.',
          'Growth & Experimentation: Designed experimentation frameworks and measurement systems to track user behavior and feature performance, applying data-driven iteration to optimize conversion and retention.',
        ],
        stack: ['ML Models', 'Data Pipelines', 'Platform Architecture', 'Experimentation', 'Go-to-Market'],
      },
      {
        role: 'Associate PM → Product Manager → Senior Product Manager',
        company: 'nCino (NASDAQ: NCNO)',
        start: '2018-12',
        end: '2024-01',
        wins: [
          'Pricing & Profitability: Designed and shipped a pricing and profitability engine that calculated risk-adjusted return on capital (RAROC) at the deal and relationship level, dynamically suggesting interest rates to maximize both RAROC and win rates as new risk data became available.',
          'Regulated Product Development: Shipped compliant lending products across multiple jurisdictions, working closely with legal and risk teams to balance underwriting innovation with regulatory requirements.',
          'Borrower Experience: Owned the full borrower experience from application through funding and repayment, implementing UX improvements that increased completion rates by 40% and reduced loan decision time by 75%.',
          'Conversion Optimization: Established a continuous-improvement culture through customer research and portfolio analytics, identifying friction points in the lending funnel and systematically eliminating them.',
          'Multi-Surface Ownership: Managed products across origination, risk, and servicing, ensuring a cohesive experience throughout the borrower journey at 250+ banks and credit unions.',
        ],
        stack: ['Pricing & RAROC', 'Lending Platforms', 'Regulatory Compliance', 'Funnel Optimization', 'A/B Testing'],
      },
    ],
  },

  trophies: [
    {
      id: 'audial',
      name: 'Audial',
      oneLiner: 'An AI audio suite for musicians and producers: music generation, resynthesis, text-to-vocal, stem separation, mastering and MIDI conversion.',
      image: '/site/trophies/audial.jpg',
      stack: ['Audio ML', 'Music Generation', 'GPU Inference', 'Data Pipelines', 'Subscriptions'],
      links: [{ label: 'VIEW', href: 'https://www.audialmusic.ai/' }],
      story: [
        'Audial is my company: a professional audio suite powered by AI, built for musicians and producers. Generate original music from text prompts, lyrics or reference audio; rebuild any sound as a synth patch; turn lyrics into a sung vocal; split songs into stems; master tracks; convert audio to MIDI; and analyse audio.',
        'I built and launched it solo from scratch — architecture, ML models, data pipelines and go-to-market — and scaled it to thousands of monthly active users with zero downtime, using experiments and measurement to tune conversion and retention.',
      ],
    },
    {
      id: 'portraitly',
      name: 'Portraitly',
      oneLiner: 'Turn your pet photos into art: AI portraits in 8 styles, in seconds, with canvas, framed and metal prints.',
      image: '/site/trophies/portraitly.jpg',
      stack: ['Image Generation', 'Web App', 'Credit Payments', 'Print-on-Demand'],
      links: [{ label: 'VIEW', href: 'https://portraitly.co/' }],
      story: [
        'Upload a pet photo, pick a style — oil painting, watercolor, pop art, Renaissance, anime, 3D cartoon, pencil sketch or stained glass — and get a finished portrait in seconds.',
        'No subscription: simple credits that never expire, and printed canvas, framed and metal portraits fulfilled through a print partner, so a photo on your phone becomes art on the wall.',
      ],
    },
    {
      id: 'audial-synth',
      name: 'Audial Synth (sound2vital)',
      oneLiner: 'A polyphonic wavetable synth with RESYNTH: drop in a sample and get it back as a fully editable synth patch.',
      image: '/site/trophies/audial-synth.jpg',
      stack: ['C++', 'JUCE', 'DSP', 'VST3 · AU · LV2', 'Audial API'],
      links: [{ label: 'CODE', href: 'https://github.com/AudialAI/sound2vital-gui' }],
      story: [
        'A wavetable synthesizer — spectral warping oscillators, a wavetable editor, a modulation matrix and a full effects chain — that builds as a VST3, Audio Unit, LV2 plug-in and a standalone app.',
        'Its RESYNTH panel is the new part: drop in a one-shot sample of up to 20 seconds, the Audial API analyses it and returns a patch, and every oscillator, envelope and effect stays editable like any other preset.',
        'It is an open-source (GPLv3) fork of the Vital synthesizer by Matt Tytel, separately named and not affiliated with that project.',
      ],
    },
    {
      id: 'text2vox',
      name: 'text2vox',
      oneLiner: 'Type lyrics and a melody and get a sung vocal back — rendered on GPUs and dragged straight into your DAW.',
      image: '/site/trophies/text2vox.jpg',
      stack: ['C++', 'JUCE', 'VST3', 'Vocal Synthesis', 'GPU Workers'],
      links: [{ label: 'VIEW', href: 'https://github.com/AudialAI/text2vox-releases' }],
      story: [
        'A music plug-in for writing vocals: draw or import a melody in its piano roll, type the lyrics, give it a reference timbre, and render a sung vocal performance.',
        'Renders run through the Audial API, which authenticates the request, checks the subscription and fans the job out to GPU workers; the finished audio drags straight out of the plug-in into your DAW.',
      ],
    },
    {
      id: 'surf-game',
      name: 'Kelly-style Surf Game',
      oneLiner: 'A PS2-era surf game in the browser: pump, carve and get barrelled on an endless peeling wave.',
      image: '/site/trophies/surf-game.jpg',
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
  ],

  credits: {
    email: 'zachfarrell13@gmail.com',
    links: [
      { label: 'LINKEDIN', href: 'https://www.linkedin.com/in/zachfarrell13' },
      { label: 'GITHUB · zfarrell13', href: 'https://github.com/zfarrell13' },
      { label: 'GITHUB · AudialAI', href: 'https://github.com/AudialAI' },
    ],
  },
};

/** Career seasons, newest first (by start month); the input is not changed. */
export function seasonsNewestFirst(seasons: readonly Season[] = site.career.seasons): Season[] {
  return [...seasons].sort((a, b) => b.start.localeCompare(a.start));
}
