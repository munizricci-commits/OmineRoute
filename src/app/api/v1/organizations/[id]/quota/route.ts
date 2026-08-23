import { handleCorsOptions } from "@/shared/utils/cors";
import { getOrganizationQuotaHandler, setOrganizationQuotaHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return getOrganizationQuotaHandler(request, ctx);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return setOrganizationQuotaHandler(request, ctx);
}
