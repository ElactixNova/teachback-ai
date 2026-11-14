import type { Metadata } from "next";
import { Caveat, Inter } from "next/font/google";
import "./globals.css";

// Inter for all interface text; Caveat only for handwriting on the whiteboard (Figma: Hand/Board).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"] });
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"], weight: ["700"] });

export const metadata: Metadata = {
  title: "Feynman AI",
  description: "Learn it by teaching it: explain a topic to an AI student and see it marked against your mark scheme.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${caveat.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
