import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { POPSTATE_GUARD_SCRIPT } from "@/lib/popstate-guard";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport: Viewport = { viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Switchyard — Databases",
  description: "A Railway-style control plane for Dokploy.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script id="switchyard-popstate-guard" dangerouslySetInnerHTML={{ __html: POPSTATE_GUARD_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
