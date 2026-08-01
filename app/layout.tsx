import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Average Derivative Lab — Locally centered EDR",
  description: "An interactive laboratory for the modified, locally centered single-index EDR procedure.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
