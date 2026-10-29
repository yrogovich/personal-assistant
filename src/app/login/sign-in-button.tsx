"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void authClient.signIn.social({ provider: "google", callbackURL: callbackUrl, errorCallbackURL: "/login" });
      }}
    >
      {pending ? "Redirecting…" : "Sign in with Google"}
    </Button>
  );
}
