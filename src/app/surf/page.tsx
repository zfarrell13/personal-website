import { site } from '@/content/site';
import { sectionMetadata } from '@/site/sectionMetadata';
import SurfLoader from './SurfLoader';

export const metadata = sectionMetadata('Free Surf', `${site.profile.name}'s surf game: pump, carve and get barrelled on a peeling wave.`);

export default function SurfPage() {
  return <SurfLoader />;
}
