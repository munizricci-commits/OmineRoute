import { handleCorsOptions } from "@/shared/utils/cors";
import { createOrganizationHandler, listOrganizationsHandler } from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function POST(request: Request) {
  return createOrganizationHandler(request);
}

export async function GET(request: Request) {
  return listOrganizationsHandler(request);
}
