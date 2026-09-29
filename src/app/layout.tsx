import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Leitor de XML", template: "%s | Leitor de XML" },
  description: "Coleta em lote de NF-e/NFC-e do Fisco Fácil (SEFAZ-RJ) — Moreira & Castro.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className="font-sans antialiased">{children}</body></html>;
}
