"use client";

import { Loader, RotateCw, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { AnalysisBlockView } from "@/components/ai/analysis-block";
import { Button } from "@/components/ui/button";
import type { AnalysisBlock } from "@/lib/ai/tools";
import type { AnalysisScope } from "@/types/domain";

/**
 * The AI analysis panel — the client centerpiece. On demand it POSTs a compact
 * activity summary to `/api/ai/analyze` and renders the streamed typed blocks as
 * they arrive (NDJSON, one block per line), so insights appear progressively
 * rather than all at once.
 *
 * The same panel serves the live dashboard and the public demo: with no AI key
 * configured the endpoint streams a deterministic, data-grounded analysis.
 */

/** The activity fields the panel forwards to the analyze endpoint. */
export interface AnalysisPanelActivity {
  startDate: Date | string;
  distance: number;
  movingTime: number;
  averageSpeed?: number | null;
  averageHeartrate?: number | null;
  totalElevationGain?: number | null;
}

type Status = "idle" | "streaming" | "done" | "error";

export function AnalysisPanel({
  activities,
  scope = "overall",
}: {
  activities: AnalysisPanelActivity[];
  scope?: AnalysisScope;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [blocks, setBlocks] = useState<AnalysisBlock[]>([]);

  const runAnalysis = useCallback(async () => {
    setStatus("streaming");
    setBlocks([]);

    const payload = activities.map((a) => ({
      startDate: typeof a.startDate === "string" ? a.startDate : a.startDate.toISOString(),
      distance: a.distance,
      movingTime: a.movingTime,
      averageSpeed: a.averageSpeed ?? null,
      averageHeartrate: a.averageHeartrate ?? null,
      totalElevationGain: a.totalElevationGain ?? null,
    }));

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, activities: payload }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const pushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const obj = JSON.parse(trimmed);
          if (obj && typeof obj.tool === "string") {
            setBlocks((prev) => [...prev, obj as AnalysisBlock]);
          }
        } catch {
          // Ignore malformed lines (e.g. a half-flushed chunk).
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          pushLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
      }
      pushLine(buffer);

      setStatus("done");
    } catch {
      setStatus("error");
    }
  }, [activities, scope]);

  const isStreaming = status === "streaming";

  return (
    <section className="rounded-[20px] border border-border bg-card p-6 shadow-float">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-control bg-volt/10">
            <Sparkles className="size-4.5 text-volt" />
          </span>
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight text-fg">
              AI Analysis
            </h2>
            <p className="text-sm text-sub">Coaching insights from your recent training</p>
          </div>
        </div>

        <Button onClick={runAnalysis} disabled={isStreaming} size="lg">
          {isStreaming ? (
            <>
              <Loader className="size-4 animate-spin" />
              Analysing…
            </>
          ) : status === "done" || status === "error" ? (
            <>
              <RotateCw className="size-4" />
              Regenerate
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Analyse my training
            </>
          )}
        </Button>
      </div>

      {status === "idle" ? (
        <p className="mt-6 text-sm text-muted">
          Run an analysis to see trends, comparisons, and a recommended next workout — generated
          from your activity data.
        </p>
      ) : null}

      {status === "error" ? (
        <p className="mt-6 text-sm text-signal">
          Something went wrong generating your analysis. Please try again.
        </p>
      ) : null}

      {blocks.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {blocks.map((block, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are append-only and never reordered
              key={i}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <AnalysisBlockView block={block} />
            </div>
          ))}
        </div>
      ) : null}

      {isStreaming && blocks.length === 0 ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Loader className="size-4 animate-spin text-volt" />
          Reading your training…
        </div>
      ) : null}
    </section>
  );
}
