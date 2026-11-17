import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Mesma fonte do portal, auto-hospedada no build (a CSP segue com font-src 'self').
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Leitor de XML", template: "%s | Leitor de XML" },
  description: "Coleta em lote de NF-e/NFC-e do Fisco Fácil (SEFAZ-RJ) — Moreira & Castro.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" className={inter.variable}><body className="antialiased">{children}</body></html>;
}
