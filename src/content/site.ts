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
      'I am a self-made entrepreneur and hyper-embedded in all things tech. In my free time, I like to experiment with bleeding-edge technology, surf, and compose music.',
      'Professionally, I have a fintech and AI background, currently building AI Platforms and Agent Governance for multi-billion dollar companies. I work in hyperproductive bursts with the intent to ship fast, get feedback, and iterate quickly. I care about making an impact to the bottom line.',
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
