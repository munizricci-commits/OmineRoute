import { handleCorsOptions } from "@/shared/utils/cors";
import { listConnectionsHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return listConnectionsHandler(request, ctx);
}
