import type { Metadata } from "next";
import "./globals.css";
import "./visual-theme.css";

export const metadata: Metadata = {
  title: "천권태권도장 | 회원·출석 관리",
  description: "천권태권도장 회원, 이용권, 출석 관리 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
