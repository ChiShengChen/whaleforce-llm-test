"use client";

import { useState } from "react";
import { createJob, JobView, StepEvent, subscribeEvents } from "@/lib/api";

const STATE_COLOR: Record<string, string> = {
  PLAN: "text-blue-400",
  LOCATE: "text-cyan-400",
  ACT: "text-emerald-400",
  VERIFY: "text-yellow-400",
  DIAGNOSE: "text-orange-400",
  DONE: "text-emerald-500",
  ESCALATE: "text-red-400",
};

const EXAMPLES = [
  "Search Wikipedia for 'Alan Turing' and extract the first paragraph of the article.",
  "Go to Hacker News and list the titles of the top 5 front-page stories.",
  "Search arxiv.org for 'sparse attention' and return the title of the first result.",
];

export default function Task1Page() {
  const [task, setTask] = useState("");
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!task.trim()) return;
    setBusy(true);
    setErr(null);
    setEvents([]);
    setJob(null);
    try {
      const j = await createJob(task.trim());
      setJob(j);
      subscribeEvents(
        j.job_id,
        (ev) => setEvents((prev) => [...prev, ev]),
        (final) => { setJob(final); setBusy(false); },
      );
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">Task 1 — Browser Agent</h1>
        <p className="text-sm text-zinc-400">
          Submit a natural-language task. The agent runs PLAN → LOCATE → ACT →
          VERIFY for each step, with DIAGNOSE-based recovery on failure. Live
          progress streams below.
        </p>
      </section>

      <section className="border border-zinc-800 rounded-md p-4 space-y-3">
        <textarea
          className="w-full bg-zinc-900 border border-zinc-800 rounded p-3 text-sm font-mono"
          rows={3}
          placeholder="e.g. Search Wikipedia for 'Alan Turing' and return the article's first paragraph."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2 text-xs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setTask(ex)}
              className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 hover:text-zinc-100"
              disabled={busy}
            >
              {ex.slice(0, 60)}…
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || !task.trim()}
            className="px-3 py-2 bg-emerald-600 disabled:bg-zinc-700 text-zinc-50 text-sm rounded"
          >
            {busy ? "Running…" : "Run task"}
          </button>
          {job && (
            <span className="text-xs text-zinc-500">
              job <code className="text-zinc-300">{job.job_id}</code> · status{" "}
              <code className={STATE_COLOR[job.status?.toUpperCase()] || "text-zinc-300"}>
                {job.status}
              </code>
              {job.total_cost_usd > 0 && (
                <> · cost <code className="text-zinc-300">${job.total_cost_usd.toFixed(4)}</code></>
              )}
            </span>
          )}
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </section>

      <section className="border border-zinc-800 rounded-md p-4">
        <h2 className="text-sm font-semibold mb-2 text-zinc-300">Live progress</h2>
        {events.length === 0 && <p className="text-xs text-zinc-500">No events yet.</p>}
        <ol className="space-y-1 text-xs font-mono">
          {events.map((e) => (
            <li key={e.sequence} className="flex gap-3">
              <span className="text-zinc-600 w-8">#{e.sequence}</span>
              <span className={STATE_COLOR[e.state] || "text-zinc-300"}>
                [{e.state}{e.step_index !== null ? `:${e.step_index}` : ""}]
              </span>
              <span className="text-zinc-200">{e.message}</span>
            </li>
          ))}
        </ol>
      </section>

      {job && job.final_output && (
        <section className="border border-emerald-800/40 bg-emerald-950/20 rounded-md p-4">
          <h2 className="text-sm font-semibold mb-2 text-emerald-400">Final output</h2>
          <pre className="text-xs whitespace-pre-wrap text-zinc-200">
            {JSON.stringify(job.final_output, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
