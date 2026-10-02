import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LikeButton } from '@/components/like-button';

export async function LatestLoops({ limit = 12 }: { limit?: number }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: loops } = await supabase
    .from('loops')
    .select('id, user_id, video_id, title, marks, like_count, profiles(username)')
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Parmi ces publications, lesquelles l'utilisateur connecté a-t-il déjà aimées ?
  let likedIds = new Set<string>();
  if (user && loops?.length) {
    const { data: likes } = await supabase
      .from('likes')
      .select('loop_id')
      .in(
        'loop_id',
        loops.map((l) => l.id)
      );
    likedIds = new Set((likes ?? []).map((l) => l.loop_id));
  }

  return (
    <section className="mx-auto w-full max-w-5xl p-4">
      <h2 className="mb-4 text-xl font-semibold">Dernières publications</h2>

      {!loops?.length ? (
        <p className="text-sm text-muted-foreground">Aucune publication pour l'instant.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loops.map((loop) => {
            const profile: any = loop.profiles;
            const author = (Array.isArray(profile) ? profile[0] : profile)?.username ?? 'Anonyme';
            const segments = loop.marks.length + 1;
            return (
              <li key={loop.id} className="flex flex-col overflow-hidden rounded-lg border">
                <Link href={`/l/${loop.id}`} className="group flex flex-col">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${loop.video_id}/hqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full bg-muted object-cover transition-opacity group-hover:opacity-90"
                  />
                  <span className="line-clamp-2 px-3 pt-3 font-medium">{loop.title}</span>
                </Link>
                <div className="mt-auto flex items-center justify-between gap-2 px-3 pb-2 pt-1 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">
                    @{author} · {segments} segment{segments > 1 ? 's' : ''}
                  </span>
                  <LikeButton
                    loopId={loop.id}
                    initialCount={loop.like_count}
                    initialLiked={likedIds.has(loop.id)}
                    isOwn={user?.id === loop.user_id}
                    loggedIn={!!user}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
