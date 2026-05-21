"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  JobInspectorPayload,
  StepResult,
  artifactUrl,
  getJobInspector,
} from "@/lib/api";

const STATE_COLOR: Record<string, string> = {
  PLAN: "text-blue-400",
  LOCATE: "text-cyan-400",
  ACT: "text-emerald-400",
  VERIFY: "text-yellow-400",
  DIAGNOSE: "text-orange-400",
  DONE: "text-emerald-500",
  ESCALATE: "text-red-400",
};

const STATUS_COLOR: Record<string, string> = {
  succeeded: "text-emerald-400",
  escalated: "text-orange-400",
  failed: "text-red-400",
  quarantined: "text-yellow-400",
  running: "text-cyan-400",
  pending: "text-zinc-400",
};

function StepCard({ step }: { step: StepResult }) {
  const [open, setOpen] = useState(!step.success);  // failed steps open by default
  return (
    <div
      className={`border rounded-md ${
        step.success
          ? "border-zinc-800 bg-zinc-900/30"
          : "border-red-900/60 bg-red-950/20"
      }`}
    >
      <button
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-xs"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-8 text-zinc-500 font-mono">#{step.step_index}</span>
        <span className={`font-mono w-20 ${STATE_COLOR[step.state] || "text-zinc-300"}`}>
          {step.state}
        </span>
        <span className="flex-1 text-zinc-200 truncate">
          {step.success ? "✅ passed" : `❌ ${step.failure_kind || "fail"}: ${step.error_message?.slice(0, 90) || ""}`}
        </span>
        <span className="text-zinc-500 font-mono">{(step.duration_ms / 1000).toFixed(1)}s</span>
        <span className="text-zinc-600 font-mono">${step.cost_usd.toFixed(4)}</span>
        <span className="text-zinc-600 w-4 text-center">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-zinc-800/50 grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Screenshot</div>
            {step.screenshot_ref ? (
              <a href={artifactUrl(step.screenshot_ref.key)} target="_blank" rel="noopener">
                <img
                  src={artifactUrl(step.screenshot_ref.key)}
                  alt={`step ${step.step_index} screenshot`}
                  className="border border-zinc-800 rounded max-w-full"
                />
              </a>
            ) : (
              <p className="text-zinc-600 text-xs">no screenshot</p>
            )}
            {step.screenshot_ref && (
              <p className="text-zinc-600 text-[10px] mt-1 font-mono">
                {(step.screenshot_ref.size_bytes / 1024).toFixed(0)} KB · {step.screenshot_ref.key}
              </p>
            )}
          </div>
          <div className="text-xs text-zinc-300 space-y-2">
            {step.error_message && (
              <div>
                <div className="text-zinc-500">Error message</div>
                <div className="text-red-300 font-mono whitespace-pre-wrap">{step.error_message}</div>
              </div>
            )}
            {step.failure_kind && (
              <div>
                <div className="text-zinc-500">Failure kind</div>
                <code className="text-orange-300">{step.failure_kind}</code>
              </div>
            )}
            {step.dom_snapshot_ref && (
              <div>
                <div className="text-zinc-500">DOM snapshot</div>
                <a
                  href={artifactUrl(step.dom_snapshot_ref.key)}
                  target="_blank"
                  rel="noopener"
                  className="text-blue-400 underline font-mono"
                >
                  open {step.dom_snapshot_ref.key.split("/")[1]} ({(step.dom_snapshot_ref.size_bytes / 1024).toFixed(0)} KB)
                </a>
              </div>
            )}
            <div className="text-zinc-500 text-[10px] font-mono pt-1">
              {step.started_at?.slice(11, 19)} → {step.ended_at?.slice(11, 19)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobInspectorPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [data, setData] = useState<JobInspectorPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getJobInspector(jobId).then(setData).catch((e) => setErr(String(e)));
  }, [jobId]);

  if (err) return <p className="text-sm text-red-400">{err}</p>;
  if (!data) return <p className="text-xs text-zinc-500">Loading job {jobId}…</p>;

  const job = data.job;
  const meta = data.eval_metadata;
  const statusClass = STATUS_COLOR[job.status] || "text-zinc-300";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Job inspector</h1>
        <div className="text-xs text-zinc-500 mt-1 font-mono space-x-3">
          <span>job <span className="text-zinc-300">{job.job_id}</span></span>
          <span>·</span>
          <span>source: <code className="text-zinc-400">{data.source}</code></span>
          <span>·</span>
          <span>status: <span className={statusClass}>{job.status}</span></span>
          <span>·</span>
          <span>steps: {job.steps.length}</span>
          <span>·</span>
          <span>recovery: {job.recovery_attempts}</span>
          <span>·</span>
          <span>cost: ${job.total_cost_usd.toFixed(4)}</span>
        </div>
      </header>

      {/* Eval metadata block (only when loaded from eval sidecar) */}
      {meta && (
        <section className={`border rounded-md p-3 ${meta.passed ? "border-emerald-800/50 bg-emerald-950/20" : "border-red-800/50 bg-red-950/20"}`}>
          <div className="flex items-baseline gap-3 mb-2">
            <span className={`text-sm font-semibold ${meta.passed ? "text-emerald-300" : "text-red-300"}`}>
              {meta.passed ? "✅ eval pass" : "❌ eval fail"}
            </span>
            <code className="text-xs text-zinc-300">case: {meta.case_id}</code>
          </div>
          {meta.failure_reason && (
            <div className="text-xs text-red-300 font-mono mb-2">
              → {meta.failure_reason}
            </div>
          )}
          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer">Assertions</summary>
            <pre className="text-zinc-300 mt-2 whitespace-pre-wrap">
              {JSON.stringify(meta.assertions, null, 2)}
            </pre>
          </details>
          {meta.fault_inject && (
            <details className="text-xs mt-2">
              <summary className="text-zinc-500 cursor-pointer">
                Fault injection {meta.fault_status && "(triggered: " + (meta.fault_status as { triggered_count?: number }).triggered_count + "x)"}
              </summary>
              <pre className="text-zinc-300 mt-2 whitespace-pre-wrap">
                {JSON.stringify({ inject: meta.fault_inject, status: meta.fault_status }, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}

      {/* Task description + plan */}
      <section className="border border-zinc-800 rounded-md p-3 space-y-2">
        <div>
          <div className="text-xs text-zinc-500 uppercase">Task</div>
          <p className="text-sm text-zinc-200 mt-1">{job.task_description}</p>
        </div>
        {job.target_url && (
          <div>
            <div className="text-xs text-zinc-500 uppercase">Target URL (planner)</div>
            <a href={job.target_url} target="_blank" rel="noopener" className="text-xs text-blue-400 underline font-mono break-all">
              {job.target_url}
            </a>
          </div>
        )}
        <details>
          <summary className="text-xs text-zinc-500 cursor-pointer mt-2">Plan ({job.plan.length} steps)</summary>
          <ol className="text-xs font-mono mt-2 space-y-1">
            {job.plan.map((p) => (
              <li key={p.index} className="text-zinc-300">
                <span className="text-zinc-500">{p.index}.</span>{" "}
                <span className="text-cyan-400">{p.action}</span> → {p.target_description}
                {p.value && <span className="text-zinc-500"> [value: {String(p.value).slice(0, 50)}]</span>}
                <div className="text-zinc-500 pl-5">criteria: {p.success_criteria}</div>
              </li>
            ))}
          </ol>
        </details>
      </section>

      {/* Per-step trace */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-200">Step trace</h2>
        {job.steps.length === 0 ? (
          <p className="text-xs text-zinc-500">No step results recorded.</p>
        ) : (
          job.steps.map((s: StepResult, i: number) => <StepCard key={i} step={s} />)
        )}
      </section>

      {/* Final output */}
      {job.final_output && (
        <section className="border border-emerald-800/40 bg-emerald-950/20 rounded-md p-3">
          <div className="text-xs text-emerald-400 uppercase mb-1">Final output</div>
          <pre className="text-xs text-zinc-200 whitespace-pre-wrap font-mono">
            {JSON.stringify(job.final_output, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
