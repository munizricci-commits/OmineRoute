import { handleCorsOptions } from "@/shared/utils/cors";
import { getInvitationByTokenHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  return getInvitationByTokenHandler(request, ctx);
}
