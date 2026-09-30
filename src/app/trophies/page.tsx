import { site } from '@/content/site';
import { SectionScreen } from '@/site/SectionScreen';
import { sectionMetadata } from '@/site/sectionMetadata';
import { Trophies } from '@/site/sections/Trophies';

export const metadata = sectionMetadata('Trophy Room', `Projects by ${site.profile.name}, starting with the surf game behind this site.`);

export default function TrophiesPage() {
  return (
    <SectionScreen title="TROPHY ROOM">
      <Trophies trophies={site.trophies} />
    </SectionScreen>
  );
}
