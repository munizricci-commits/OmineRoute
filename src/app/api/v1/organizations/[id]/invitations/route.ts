import { handleCorsOptions } from "@/shared/utils/cors";
import { listInvitationsHandler, createInvitationHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return listInvitationsHandler(request, ctx);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return createInvitationHandler(request, ctx);
}
