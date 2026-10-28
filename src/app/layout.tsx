import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Invictus ERP Mobile · Estoque e PDV",
  description:
    "Gestão de produtos, aparelhos, estoque e frente de caixa por filial.",
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
