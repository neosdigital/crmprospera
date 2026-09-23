import { NextResponse } from "next/server";
import { requireSession, jsonError, ApiError } from "@/lib/api";
import { sendTestPush } from "@/lib/push-server";

export async function POST() {
  try {
    const session = await requireSession(["OWNER", "ADMIN"]);
    const result = await sendTestPush(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && !(error instanceof ApiError)) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return jsonError(error);
  }
}
