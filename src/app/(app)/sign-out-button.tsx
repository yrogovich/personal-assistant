"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      onClick={() => void authClient.signOut().then(() => router.replace("/login"))}
    >
      <LogOut aria-hidden />
    </Button>
  );
}
