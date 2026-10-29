import { SignInButton } from "./sign-in-button";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, callbackUrl } = await searchParams;
  // Better Auth redirects here with ?error=<code>; a blocked account shows up as a failed user/session create.
  const message =
    typeof error === "string"
      ? "Sign-in failed. This dashboard is private: use the allowed Google account."
      : null;
  const target = typeof callbackUrl === "string" && callbackUrl.startsWith("/") ? callbackUrl : "/today";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Private. Sign in to continue.</p>
      </div>
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
      <SignInButton callbackUrl={target} />
    </main>
  );
}
