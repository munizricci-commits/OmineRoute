import OrgDetailClient from "./OrgDetailClient";

export const dynamic = "force-dynamic";

export default async function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrgDetailClient orgId={id} />;
}
