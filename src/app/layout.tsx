/**
 * Root Layout (Server Component)
 *
 * Wraps all pages with consistent header, fonts, and global styles.
 * ClientHeader is a separate client component to handle auth state
 * without making the entire layout a client component.
 */

// src/app/layout.tsx  (SERVER component)
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientHeader from "./clientheader"; // client component

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Shift Happens",
  description: "Time clock & checklist",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ClientHeader />
        {children}
      </body>
    </html>
  );
}
