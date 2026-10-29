import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Invictus ERP Mobile · Estoque, PDV e Assistência",
  description: "Gestão de estoque, vendas e assistência técnica por filial.",
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
