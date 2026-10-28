import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

export const metadata: Metadata = {
  title: "Arclia — arXiv日本語研究ダイジェスト",
  description:
    "arXivの最新研究論文を30秒要点・3分要約・10分解説の3段階と根拠箇所付きで素早く把握できる日本語研究ダイジェスト",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <AppFooter />
      </body>
    </html>
  );
}
