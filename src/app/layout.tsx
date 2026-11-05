import type { Metadata } from "next";
import { Libre_Franklin } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/wall.css";
import "@/styles/pages.css";
import "@/styles/motion.css";

const franklin = Libre_Franklin({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-franklin", display: "swap" });

export const metadata: Metadata = {
  title: { default: "MoPC · Museum of Prompt Chains", template: "%s · MoPC" },
  description: "Superadmin workshop for building, ordering and running Hog Wumbia's prompt chains.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={franklin.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
