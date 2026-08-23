import { handleCorsOptions } from "@/shared/utils/cors";
import {
  getOrganizationHandler,
  updateOrganizationHandler,
  deleteOrganizationHandler,
} from "@/lib/org/orgApiService";

export async function OPTIONS() {
  return handleCorsOptions();
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return getOrganizationHandler(request, ctx);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return updateOrganizationHandler(request, ctx);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return deleteOrganizationHandler(request, ctx);
}
