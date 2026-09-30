import { site } from '@/content/site';
import { SectionScreen } from '@/site/SectionScreen';
import { sectionMetadata } from '@/site/sectionMetadata';
import { Credits } from '@/site/sections/Credits';

export const metadata = sectionMetadata('Credits', `Contact ${site.profile.name}: email, links and resume.`);

export default function CreditsPage() {
  return (
    <SectionScreen title="CREDITS">
      <Credits credits={site.credits} resumePdf={site.career.resumePdf} />
    </SectionScreen>
  );
}
