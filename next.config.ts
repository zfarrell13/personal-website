import type { NextConfig } from 'next';

/**
 * Sent on every route. The CSP only sets frame-ancestors (no script-src): Next's inline scripts and the dev
 * server keep working, and the site can't be framed by another origin (clickjacking).
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
