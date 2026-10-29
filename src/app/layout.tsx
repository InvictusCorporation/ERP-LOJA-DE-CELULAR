import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Invictus ERP Mobile · Estoque, PDV, Assistência e CRM",
  description: "Gestão de estoque, vendas, assistência técnica e clientes por filial.",
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
