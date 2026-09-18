export class FetchError extends Error {
  status: number;
  info: unknown;
  constructor(message: string, status: number, info: unknown) {
    super(message);
    this.status = status;
    this.info = info;
  }
}

export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const info = await res.json().catch(() => undefined);
    throw new FetchError((info as { error?: string })?.error ?? "Erro ao buscar dados", res.status, info);
  }
  return res.json();
}

export async function poster<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const info = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new FetchError((info as { error?: string })?.error ?? "Erro na requisição", res.status, info);
  }
  return info as T;
}
