import { site } from '@/content/site';
import { SectionScreen } from '@/site/SectionScreen';
import { sectionMetadata } from '@/site/sectionMetadata';
import { Profile } from '@/site/sections/Profile';

const { name, title, location } = site.profile;
export const metadata = sectionMetadata('Rider Profile', `${name}: ${title}, ${location}.`);

export default function ProfilePage() {
  return (
    <SectionScreen title="RIDER PROFILE">
      <Profile profile={site.profile} />
    </SectionScreen>
  );
}
