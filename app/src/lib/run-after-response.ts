import { after } from "next/server";

/**
 * Roda `fn` depois da resposta ser enviada (via `after()` do Next.js) sem atrasar nem
 * arriscar ser interrompida quando a serverless function retorna (ver notas em push-server.ts).
 * `after()` exige um contexto de requisição real do Next.js — chamando o route handler direto
 * fora desse contexto (ex.: dentro dos testes do Vitest) ele lança sincronamente. Nesse caso
 * caímos pra fire-and-forget simples, só pra não derrubar o fluxo principal.
 */
export function runAfterResponse(fn: () => Promise<void>): void {
  try {
    after(fn);
  } catch {
    fn().catch(() => {});
  }
}
