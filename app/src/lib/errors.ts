import { NextResponse } from "next/server";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[API] erro não tratado:", error);
  return NextResponse.json({ error: "Ocorreu um erro inesperado. Tente novamente." }, { status: 500 });
}
