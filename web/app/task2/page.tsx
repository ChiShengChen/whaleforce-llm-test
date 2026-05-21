"use client";

import { useState } from "react";
import {
  ExtractedItem,
  Task2Job,
  createExtraction,
  pollExtraction,
} from "@/lib/api";

const EXAMPLES: { label: string; url: string }[] = [
  {
    label: "AAPL 2023 10-K",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
  },
  {
    label: "JPM 2023 10-K",
    url: "https://www.sec.gov/Archives/edgar/data/19617/000001961724000337/jpm-20231231.htm",
  },
  {
    label: "MSFT 2023 10-K",
    url: "https://www.sec.gov/Archives/edgar/data/789019/000095017023035122/msft-20230630.htm",
  },
];

function confidenceTone(c: number): string {
  if (c >= 0.8) return "text-emerald-400";
  if (c >= 0.5) return "text-yellow-400";
  return "text-red-400";
}

function confidenceBg(c: number): string {
  if (c >= 0.8) return "bg-emerald-950/40 border-emerald-800/40";
  if (c >= 0.5) return "bg-yellow-950/40 border-yellow-800/40";
  return "bg-red-950/40 border-red-800/40";
}

function ItemCard({ item }: { item: ExtractedItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-md ${confidenceBg(item.confidence)}`}>
      <button
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-xs"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-zinc-200 font-mono font-semibold w-16">
          Item {item.item_id}
        </span>
        <span className="flex-1 text-zinc-300 truncate">{item.title}</span>
        <span className={`font-mono ${confidenceTone(item.confidence)}`}>
          {(item.confidence * 100).toFixed(0)}%
        </span>
        <span className="text-zinc-500 font-mono w-16 text-right">
          {item.char_length.toLocaleString()} ch
        </span>
        <span className="text-zinc-600 font-mono">{item.extraction_method}</span>
        <span className="text-zinc-600 w-4 text-center">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-zinc-300 max-h-96 overflow-y-auto whitespace-pre-wrap border-t border-zinc-800/50">
          {item.notes && (
            <div className="mb-2 text-orange-400 font-mono">
              note: {item.notes}
            </div>
          )}
          {item.content.slice(0, 5000)}
          {item.content.length > 5000 && (
            <div className="text-zinc-600 mt-2">… (truncated; {item.char_length - 5000} more chars)</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Task2Page() {
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Task2Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    setJob(null);
    try {
      const j = await createExtraction(trimmed);
      setJob(j);
      pollExtraction(j.job_id, (next) => {
        setJob(next);
        if (next.status !== "pending" && next.status !== "running") setBusy(false);
      });
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  const ext = job?.extraction;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Task 2 — SEC 10-K Item Extractor</h1>
        <p className="text-sm text-zinc-400">
          Paste an EDGAR filing URL. The pipeline ingests, normalizes, runs L1
          anchor extraction, and scores per-item + overall confidence. Low
          confidence → quarantined (no silent wrong output).
        </p>
      </header>

      <section className="border border-zinc-800 rounded-md p-4 space-y-3">
        <input
          type="text"
          className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs font-mono"
          placeholder="https://www.sec.gov/Archives/edgar/data/.../xxx-20231231.htm"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2 text-xs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.url}
              onClick={() => setUrl(ex.url)}
              className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100"
              disabled={busy}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || !url.trim()}
            className="px-3 py-2 bg-emerald-600 disabled:bg-zinc-700 text-zinc-50 text-sm rounded"
          >
            {busy ? "Extracting…" : "Extract items"}
          </button>
          {job && (
            <span className="text-xs text-zinc-500">
              job <code className="text-zinc-300">{job.job_id}</code> · status{" "}
              <code className={confidenceTone(job.status === "succeeded" ? 1 : 0.3)}>
                {job.status}
              </code>
            </span>
          )}
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        {job?.error_message && (
          <p className="text-sm text-red-400">crash: {job.error_message}</p>
        )}
      </section>

      {ext && (
        <>
          {/* KPI bar */}
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Coverage</div>
              <div className="text-2xl font-semibold text-zinc-100">
                {ext.n_found_items} / {ext.n_expected_items}
              </div>
              <div className="text-xs text-zinc-500">
                {(ext.coverage_ratio * 100).toFixed(0)}% required items
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Overall confidence</div>
              <div className={`text-2xl font-semibold ${confidenceTone(ext.overall_confidence)}`}>
                {(ext.overall_confidence * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-500">
                {ext.quarantined ? "quarantined" : "released"}
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Method mix</div>
              <div className="text-sm font-mono mt-1 text-zinc-200">
                L1 {ext.extraction_method_summary.L1 || 0} · L2 {ext.extraction_method_summary.L2 || 0} · L3 {ext.extraction_method_summary.L3 || 0}
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Cost</div>
              <div className="text-2xl font-semibold text-zinc-100">
                ${ext.cost_usd.toFixed(4)}
              </div>
              <div className="text-xs text-zinc-500">{ext.duration_ms} ms</div>
            </div>
            <div className="border border-zinc-800 rounded-md p-3">
              <div className="text-xs text-zinc-500 uppercase">Filing</div>
              <div className="text-xs font-mono text-zinc-200 mt-1">
                CIK {ext.filing.cik || "—"}
              </div>
              <div className="text-xs font-mono text-zinc-500">
                {ext.filing.accession_number || "—"}
              </div>
            </div>
          </section>

          {/* Quarantine warning */}
          {ext.quarantine_reasons.length > 0 && (
            <section className={`border rounded-md p-3 text-xs ${ext.quarantined ? "border-red-800/60 bg-red-950/30" : "border-yellow-800/60 bg-yellow-950/20"}`}>
              <div className={`font-semibold mb-1 ${ext.quarantined ? "text-red-300" : "text-yellow-300"}`}>
                {ext.quarantined ? "QUARANTINED" : "Soft warnings"}
              </div>
              <ul className="space-y-0.5 list-disc list-inside text-zinc-300">
                {ext.quarantine_reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Items */}
          <section className="space-y-1.5">
            {ext.items.map((it) => (
              <ItemCard key={it.item_id + it.start_offset} item={it} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
