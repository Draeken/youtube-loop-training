import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { LoopEditor } from '@/components/loop-editor';
import { LatestLoops } from '@/components/latest-loops';

export default function Home() {
  return (
    <>
      {/* SiteHeader et LatestLoops lisent les cookies : ils doivent être dans un <Suspense> */}
      <Suspense fallback={<div className="h-14 border-b" />}>
        <SiteHeader />
      </Suspense>
      <main className="min-h-screen">
        <LoopEditor />
        <Suspense
          fallback={
            <section className="mx-auto w-full max-w-5xl p-4">
              <p className="text-sm text-muted-foreground">Chargement des publications…</p>
            </section>
          }>
          <LatestLoops />
        </Suspense>
      </main>
    </>
  );
}
