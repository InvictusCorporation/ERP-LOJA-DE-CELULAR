import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Invictus ERP Mobile · Produtos e Estoque",
  description: "Gestão de produtos, aparelhos e estoque por filial.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
