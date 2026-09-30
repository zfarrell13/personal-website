import { notFound } from 'next/navigation';
import RetroDemoLoader from './RetroDemoLoader';

export const metadata = { title: 'Retro renderer test' };

/** A renderer test bench for development (and the dev-server e2e suite); a production build serves a 404. */
export default function RetroDevPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <RetroDemoLoader />;
}
