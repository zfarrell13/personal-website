import { site } from '@/content/site';
import { SectionScreen } from '@/site/SectionScreen';
import { sectionMetadata } from '@/site/sectionMetadata';
import { Career } from '@/site/sections/Career';

export const metadata = sectionMetadata('Career Mode', `${site.profile.name}'s career: roles, wins and resume.`);

export default function CareerPage() {
  return (
    <SectionScreen title="CAREER MODE">
      <Career career={site.career} />
    </SectionScreen>
  );
}
