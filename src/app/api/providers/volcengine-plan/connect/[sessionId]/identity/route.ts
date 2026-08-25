import { NextResponse } from "next/server";
import { z } from "zod";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { bindVolcenginePlansFromConsoleCredentials } from "@/lib/providers/volcenginePlanBinding";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

const volcengineIdentitySchema = z.object({
  index: z.number().int().min(0),
  timeout: z.number().int().positive().max(600_000).optional(),
});

/**
 * POST /api/providers/volcengine-plan/connect/[sessionId]/identity
 * Pick an identity on the console's select_identity page (the phone maps to
 * multiple accounts) and finish the login + plan binding.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  const auth = await requireManagementAuth(request);
  if (auth) return auth;

  const { sessionId } = await params;
  const rawBody = await request.json().catch(() => ({}));
  const validation = validateBody(volcengineIdentitySchema, rawBody);
  if (isValidationFailure(validation)) {
    return NextResponse.json(
      { success: false, error: validation.error.message, details: validation.error.details },
      { status: 400 }
    );
  }
  const body = validation.data;

  try {
    const { volcengineConsoleAutoLoginService } =
      await import("@omniroute/open-sse/services/volcengineConsoleAutoLogin.ts");

    if (!volcengineConsoleAutoLoginService.getStatus(sessionId)) {
      return NextResponse.json(
        { success: false, error: "Unknown or expired Volcano login session" },
        { status: 404 }
      );
    }

    const timeout = body.timeout;
    const session = await volcengineConsoleAutoLoginService.selectIdentity(sessionId, body.index, {
      timeout,
    });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unknown or expired Volcano login session" },
        { status: 404 }
      );
    }

    // Credentials ready → bind immediately so the response carries the outcome.
    if (session.phase === "success") {
      const bound = await volcengineConsoleAutoLoginService.withBinding(sessionId, (credentials) =>
        bindVolcenginePlansFromConsoleCredentials(credentials)
      );
      return NextResponse.json({ success: true, session: bound ?? session });
    }

    return NextResponse.json({ success: false, session });
  } catch (error) {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, error: `Volcano identity selection failed: ${message}` },
      { status: 500 }
    );
  }
}
