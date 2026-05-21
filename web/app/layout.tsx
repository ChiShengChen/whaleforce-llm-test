import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Whaleforce LLM Test",
  description: "Browser Agent + 10-K Extractor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
        <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-6 text-sm">
          <a href="/" className="font-semibold">whaleforce-llm-test</a>
          <nav className="flex gap-4 text-zinc-400">
            <a href="/task1" className="hover:text-zinc-100">Task 1 · Browser Agent</a>
            <a href="/task2" className="hover:text-zinc-100">Task 2 · 10-K Extractor</a>
            <a href="/dashboard" className="hover:text-zinc-100">Dashboard</a>
          </nav>
        </header>
        <main className="px-6 py-6 max-w-6xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
