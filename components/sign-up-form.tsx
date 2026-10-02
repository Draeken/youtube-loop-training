'use client';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignUpForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    const name = username.trim();
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(name)) {
      setError("Nom d'utilisateur : 3 à 20 caractères (lettres, chiffres, _ et -).");
      setIsLoading(false);
      return;
    }

    if (password !== repeatPassword) {
      setError('Les mots de passe ne correspondent pas');
      setIsLoading(false);
      return;
    }

    try {
      // Le nom est-il libre ?
      const { data: available, error: rpcError } = await supabase.rpc('username_available', {
        name,
      });
      if (rpcError) throw rpcError;
      if (!available) {
        setError("Ce nom d'utilisateur est déjà pris.");
        return;
      }

      // Le nom voyage dans les métadonnées : un trigger SQL crée le profil
      // à la création du compte (même avant la confirmation de l'email).
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username: name },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
      router.push('/auth/sign-up-success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Une erreur est survenue';
      setError(
        message.includes('Database error')
          ? "Ce nom d'utilisateur vient d'être pris, essaie-en un autre."
          : message
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Inscription</CardTitle>
          <CardDescription>Créer un nouveau compte</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="username">Nom d'utilisateur</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="mon_pseudo"
                  required
                  minLength={3}
                  maxLength={20}
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Affiché comme auteur de tes listes publiées.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Mot de passe</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Répéter le mot de passe</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Création du compte...' : "S'inscrire"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Déjà un compte ?{' '}
              <Link href="/auth/login" className="underline underline-offset-4">
                Se connecter
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
