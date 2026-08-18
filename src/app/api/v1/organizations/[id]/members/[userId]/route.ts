import { handleCorsOptions } from "@/shared/utils/cors";
import { removeMemberHandler, updateMemberHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string; userId: string }> }
) {
  return removeMemberHandler(request, ctx);
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; userId: string }> }
) {
  return updateMemberHandler(request, ctx);
}
