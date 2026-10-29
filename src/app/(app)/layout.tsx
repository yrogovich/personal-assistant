import { requireUser } from "@/server/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { MainNav } from "./main-nav";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#main"
        className="bg-background sr-only z-10 rounded px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2">
          <MainNav />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
