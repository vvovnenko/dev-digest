import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";
import "./globals.css";
import { Providers } from "../lib/providers";
import { themeNoFlashScript } from "../lib/theme";

// Self-hosted at build time (no request to Google at runtime); globals.css uses the variable.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  // Pages set `title` to their own name; the tab reads "<page> · DevDigest".
  title: { default: "DevDigest", template: "%s · DevDigest" },
  description: "Local-first AI PR review tool",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, timeZone] = await Promise.all([getLocale(), getMessages(), getTimeZone()]);
  return (
    <html lang={locale} className={inter.variable} data-theme="dark" data-density="regular" suppressHydrationWarning>
      <head>
        {/* set theme before paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly, translators, …)
          inject attributes like data-gr-ext-installed onto <body> before React
          hydrates. This suppresses ONLY this element's own attribute mismatch
          (one level deep) — real mismatches in descendants are still reported. */}
      <body suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
          <Suspense fallback={null}>
            <Providers>{children}</Providers>
          </Suspense>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
