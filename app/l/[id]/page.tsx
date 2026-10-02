import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoopPlayer } from "@/components/loop-player";

export default async function LoopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: loop } = await supabase
    .from("loops")
    .select("video_id, title, description, author_name, marks")
    .eq("id", id)
    .single();

  if (!loop) notFound();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{loop.title}</h1>
        <p className="text-sm text-muted-foreground">par {loop.author_name}</p>
        {loop.description && (
          <p className="mt-2 whitespace-pre-line text-sm">{loop.description}</p>
        )}
      </header>
      <LoopPlayer
        readOnly
        initialVideoId={loop.video_id}
        initialMarks={loop.marks}
      />
    </main>
  );
}
