export default function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Whaleforce — LLM Engineer Coding Test</h1>
        <p className="text-zinc-400 text-sm">
          Two systems, one repo. Production-grade discipline: layered fallbacks,
          calibrated confidence, cost-attributed every LLM call, eval-as-service.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a href="/task1" className="block border border-zinc-800 rounded-md p-5 hover:border-zinc-600">
          <h2 className="text-lg font-medium">Task 1 — Browser Automation Agent</h2>
          <p className="text-sm text-zinc-400 mt-2">
            NL task → explicit state machine (PLAN/LOCATE/ACT/VERIFY/DIAGNOSE).
            Self-correction via root-cause classification, self-maintenance via
            three-pronged locators.
          </p>
        </a>
        <a href="/task2" className="block border border-zinc-800 rounded-md p-5 hover:border-zinc-600">
          <h2 className="text-lg font-medium">Task 2 — SEC 10-K Item Extractor</h2>
          <p className="text-sm text-zinc-400 mt-2">
            Layered L1 anchor → L2 structural → L3 LLM self-consistency pipeline.
            Calibrated confidence; quarantine on low confidence rather than
            emitting wrong data.
          </p>
        </a>
      </section>

      <section className="text-sm text-zinc-500">
        <p>See <code className="text-zinc-300">PLAN.md</code> in the repo for the full system design.</p>
      </section>
    </div>
  );
}
