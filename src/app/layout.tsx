import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Invictus ERP Mobile · Gestão da loja",
  description:
    "Estoque, PDV, assistência, CRM, financeiro e crediário integrados por filial.",
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
