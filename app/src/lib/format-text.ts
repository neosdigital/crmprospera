/**
 * Formata perguntas/respostas de formulários do Meta Lead Ads pra exibição no CRM.
 *
 * Formulários de múltipla escolha frequentemente retornam a CHAVE interna da pergunta/opção
 * em vez do texto legível (ex.: "o_bothanic_está_em_fase_de_obras._isso_faz_sentido_para_você?"
 * em vez de "O Bothanic está em fase de obras. Isso faz sentido para você?") — a Meta não
 * expõe o rótulo bonito por essa via da API. Isso só ajusta a EXIBIÇÃO; o valor bruto
 * continua salvo como veio em `lead.custom_fields`, sem perda de informação.
 */
export function formatMetaFieldText(raw: string): string {
  const withSpaces = raw.replace(/_/g, " ").trim();
  // Capitaliza a primeira letra do texto e a primeira letra depois de cada ./!/? seguido de espaço.
  return withSpaces.replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (match) => match.toUpperCase());
}
