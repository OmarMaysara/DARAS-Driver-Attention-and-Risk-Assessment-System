import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "DARAS - Driver Attention and Risk Assessment System",
    template: "%s — DARAS",
  },
  description:
    "Road object and distraction detection with Raspberry Pi risk scoring. Analytics for drivers and employers.",
  icons: {
    icon: "/daras_favicon.svg",
  },
};

import { ToastProvider } from "./components/toast-context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${sora.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col transition-colors duration-300">
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
