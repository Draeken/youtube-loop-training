import { SiteHeader } from '@/components/site-header';
import { LoopEditor } from '@/components/loop-editor';
import { LatestLoops } from '@/components/latest-loops';

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="min-h-screen">
        <LoopEditor />
        <LatestLoops />
      </main>
    </>
  );
}
