import { handleCorsOptions } from "@/shared/utils/cors";
import { listMembersHandler, addMemberHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return listMembersHandler(request, ctx);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return addMemberHandler(request, ctx);
}
