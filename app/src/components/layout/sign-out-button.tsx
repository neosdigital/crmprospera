import { signOut } from "@/auth";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <LogOut size={16} />
        Sair
      </button>
    </form>
  );
}
