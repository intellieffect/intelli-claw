"use client";

import { useState, useCallback, useEffect } from "react";
import { useGateway } from "./hooks";

// --- Types ---

export interface CronSchedule {
  type: "at" | "every" | "cron";
  /** ISO string for "at", e.g. "2026-03-01T09:00:00Z" */
  at?: string;
  /** Duration string for "every", e.g. "30m", "1h" */
  every?: string;
  /** Cron expression for "cron", e.g. "0 9 * * *" */
  cron?: string;
}

export interface CronPayload {
  type: "systemEvent" | "agentTurn";
  /** For systemEvent */
  eventName?: string;
  eventData?: Record<string, unknown>;
  /** For agentTurn */
  agentId?: string;
  sessionKey?: string;
  message?: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: CronSchedule;
  payload: CronPayload;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt?: string;
}

export interface CronRun {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt?: string;
  status: "ok" | "error" | "running";
  error?: string;
  durationMs?: number;
}

// --- Hook ---

export function useCron() {
  const { client, state } = useGateway();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);

  const connected = state === "connected" && !!client;

  const fetchJobs = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const res = await client!.request<{ jobs: CronJob[] }>("cron.list", {
        includeDisabled: true,
      });
      setJobs(res?.jobs || []);
    } catch (e) {
      console.error("[useCron] list error:", e);
    } finally {
      setLoading(false);
    }
  }, [client, connected]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const addJob = useCallback(
    async (job: Omit<CronJob, "id">) => {
      if (!connected) return;
      await client!.request("cron.add", { job });
      await fetchJobs();
    },
    [client, connected, fetchJobs],
  );

  const updateJob = useCallback(
    async (jobId: string, patch: Partial<CronJob>) => {
      if (!connected) return;
      await client!.request("cron.update", { jobId, patch });
      await fetchJobs();
    },
    [client, connected, fetchJobs],
  );

  const removeJob = useCallback(
    async (jobId: string) => {
      if (!connected) return;
      await client!.request("cron.remove", { jobId });
      await fetchJobs();
    },
    [client, connected, fetchJobs],
  );

  const runJob = useCallback(
    async (jobId: string) => {
      if (!connected) return;
      await client!.request("cron.run", { jobId });
    },
    [client, connected],
  );

  const fetchRuns = useCallback(
    async (jobId: string): Promise<CronRun[]> => {
      if (!connected) return [];
      try {
        const res = await client!.request<{ runs: CronRun[] }>("cron.runs", {
          jobId,
        });
        return res?.runs || [];
      } catch (e) {
        console.error("[useCron] runs error:", e);
        return [];
      }
    },
    [client, connected],
  );

  return { jobs, loading, fetchJobs, addJob, updateJob, removeJob, runJob, fetchRuns };
}
