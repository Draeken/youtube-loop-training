import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoopPlayer } from '@/components/loop-player';
import { SiteHeader } from '@/components/site-header';
import { CopyToEditorButton } from '@/components/copy-to-editor-button';
import { LikeButton } from '@/components/like-button';

export default async function LoopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: loop } = await supabase
    .from('loops')
    .select('id, user_id, video_id, title, description, marks, like_count, profiles(username)')
    .eq('id', id)
    .single();

  if (!loop) notFound();

  const profile: any = loop.profiles;
  const author = (Array.isArray(profile) ? profile[0] : profile)?.username ?? 'Anonyme';

  let liked = false;
  if (user) {
    const { data } = await supabase.from('likes').select('loop_id').eq('loop_id', id).maybeSingle();
    liked = !!data;
  }

  return (
    <>
      <SiteHeader next={`/l/${id}`} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold">{loop.title}</h1>
            <p className="text-sm text-muted-foreground">par @{author}</p>
            {loop.description && (
              <p className="mt-2 whitespace-pre-line text-sm">{loop.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LikeButton
              loopId={loop.id}
              initialCount={loop.like_count}
              initialLiked={liked}
              isOwn={user?.id === loop.user_id}
              loggedIn={!!user}
            />
            <CopyToEditorButton videoId={loop.video_id} marks={loop.marks} />
          </div>
        </header>
        <LoopPlayer readOnly initialVideoId={loop.video_id} initialMarks={loop.marks} />
      </main>
    </>
  );
}
