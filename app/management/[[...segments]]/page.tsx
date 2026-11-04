import { Suspense } from "react";
import ManagementApp from "../management-app";

export default function ManagementPage() {
  return (
    <Suspense fallback={<main className="loading-overlay">관리자 페이지를 불러오는 중이에요…</main>}>
      <ManagementApp />
    </Suspense>
  );
}
