"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadNotesDialog } from "@/components/leads/lead-notes-dialog";

/** Botão "Ver Notas" / "Adicionar Notas" fora do kanban (página do lead do dono/admin). */
export function OpenNotesButton({ leadId, noteCount }: { leadId: string; noteCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" className="w-full py-1.5 text-xs" onClick={() => setOpen(true)}>
        <StickyNote size={13} />
        {noteCount > 0 ? `Ver Notas (${noteCount})` : "Adicionar Notas"}
      </Button>
      {open && <LeadNotesDialog leadId={leadId} onClose={() => setOpen(false)} onChanged={() => router.refresh()} />}
    </>
  );
}
