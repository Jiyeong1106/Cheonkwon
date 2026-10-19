import { Suspense } from "react";
import ManagementApp from "../management-app";

type RouteParams = Promise<{ segments?: string[] }>;

async function ResolvedManagementPage({ params }: { params: RouteParams }) {
  const { segments = [] } = await params;
  return <ManagementApp segments={segments} />;
}

export default function ManagementPage({ params }: { params: RouteParams }) {
  return (
    <Suspense fallback={<main className="loading-overlay">관리자 페이지를 불러오는 중이에요…</main>}>
      <ResolvedManagementPage params={params} />
    </Suspense>
  );
}
