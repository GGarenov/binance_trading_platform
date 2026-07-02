import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CryptoStrategy Lab",
  description:
    "Learn crypto trading strategies risk-free: backtest against history and paper trade with simulated funds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col font-sans">
        <header className="border-b border-slate-800 bg-slate-950/60 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              <span className="text-indigo-400">Crypto</span>Strategy Lab
            </Link>
            <span className="text-xs text-slate-500 border border-slate-700 rounded-full px-3 py-1">
              Simulated funds only — no real money at risk
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-6 py-10 flex-1">{children}</main>
        <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
          Learning tool. Backtests and paper trading use real Binance market data with
          simulated balances. Nothing here is financial advice.
        </footer>
      </body>
    </html>
  );
}
