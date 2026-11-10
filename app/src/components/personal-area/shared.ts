/** Tipos e rótulos compartilhados pelas telas da Área do Corretor. */

export const PERSONAL_COLUMNS: { status: string; label: string }[] = [
  { status: "NEW", label: "Novo" },
  { status: "CONTACTED", label: "Contatado" },
  { status: "IN_PROGRESS", label: "Em andamento" },
  { status: "QUALIFIED", label: "Qualificado" },
  { status: "SCHEDULED", label: "Agendado" },
  { status: "CONVERTED", label: "Convertido" },
  { status: "LOST", label: "Perdido" },
  { status: "REMARKETING", label: "Remarketing" },
];

export function personalStatusLabel(status: string) {
  return PERSONAL_COLUMNS.find((c) => c.status === status)?.label ?? status;
}

export type PersonalConnection = {
  id: string;
  brokerId: string;
  brokerName?: string;
  name: string;
  accountOwnerName: string | null;
  pageId: string;
  pageName: string | null;
  adAccountId: string | null;
  adAccountName: string | null;
  status: string;
  isActive: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastLeadAt: string | null;
  createdAt: string;
  leadsReceived?: number;
  forms: { formId: string; formName: string | null; lastPolledAt: string | null }[];
};

export type PersonalLeadRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  campaignName: string | null;
  formName: string | null;
  status: string;
  sourceType: string;
  createdAt: string;
  receivedAt: string;
  updatedAt: string;
  remarketingNotifyAt: string | null;
  brokerId: string;
  brokerName: string | null;
  noteCount: number;
};

export const CONNECTION_STATUS: Record<string, { label: string; tone: "success" | "danger" | "gold" | "neutral" }> = {
  ACTIVE: { label: "Conectada", tone: "success" },
  NEEDS_RECONNECT: { label: "Reconexão necessária", tone: "danger" },
  ERROR: { label: "Com erro", tone: "danger" },
  DISCONNECTED: { label: "Desconectada", tone: "neutral" },
};

export function sourceLabel(sourceType: string) {
  return sourceType === "BROKER_PERSONAL_META" ? "Meta Ads Particular" : sourceType;
}

export function whatsappLink(phone: string | null) {
  if (!phone) return null;
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

export function buildQuery(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}
