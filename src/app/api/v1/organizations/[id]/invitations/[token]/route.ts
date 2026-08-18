import { handleCorsOptions } from "@/shared/utils/cors";
import { revokeInvitationHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string; token: string }> }
) {
  return revokeInvitationHandler(request, ctx);
}
