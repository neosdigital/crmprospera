import type { AssignmentStatus, BrokerStatus, LeadStatus } from "@crm/db";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "Novo",
  WAITING_ASSIGNMENT: "Aguardando atribuição",
  ASSIGNED: "Atribuído",
  CONTACTED: "Contatado",
  IN_PROGRESS: "Em andamento",
  QUALIFIED: "Qualificado",
  SCHEDULED: "Agendado",
  CONVERTED: "Convertido",
  LOST: "Perdido",
  EXPIRED: "Expirado",
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  ASSIGNED: "Aguardando contato",
  CONTACTED: "Contatado",
  EXPIRED: "Expirado",
  TRANSFERRED: "Transferido",
};

export const BROKER_STATUS_LABELS: Record<BrokerStatus, string> = {
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  INACTIVE: "Inativo",
};

export function leadStatusLabel(status: string): string {
  return LEAD_STATUS_LABELS[status as LeadStatus] ?? status;
}

export function assignmentStatusLabel(status: string): string {
  return ASSIGNMENT_STATUS_LABELS[status as AssignmentStatus] ?? status;
}

export function brokerStatusLabel(status: string): string {
  return BROKER_STATUS_LABELS[status as BrokerStatus] ?? status;
}
