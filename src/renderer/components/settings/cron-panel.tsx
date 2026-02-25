"use client";

import { useState, useCallback, Fragment } from "react";
import {
  Clock,
  Play,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Loader2,
  X,
  History,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCron,
  type CronJob,
  type CronRun,
  type CronSchedule,
  type CronPayload,
} from "@/lib/gateway/use-cron";

// ─── Helpers ─────────────────────────────────────────────

function scheduleLabel(s: CronSchedule): string {
  if (s.type === "at") return `Once @ ${s.at ? new Date(s.at).toLocaleString() : "?"}`;
  if (s.type === "every") return `Every ${s.every || "?"}`;
  if (s.type === "cron") return s.cron || "?";
  return String(s.type);
}

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

// ─── Delete Confirm Dialog ──────────────────────────────

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>확인</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Job Form ───────────────────────────────────────────

interface JobFormData {
  name: string;
  scheduleType: "at" | "every" | "cron";
  scheduleValue: string;
  payloadType: "systemEvent" | "agentTurn";
  eventName: string;
  eventData: string;
  agentId: string;
  sessionKey: string;
  message: string;
  enabled: boolean;
}

const emptyForm: JobFormData = {
  name: "",
  scheduleType: "every",
  scheduleValue: "",
  payloadType: "systemEvent",
  eventName: "",
  eventData: "{}",
  agentId: "",
  sessionKey: "",
  message: "",
  enabled: true,
};

function formFromJob(job: CronJob): JobFormData {
  return {
    name: job.name,
    scheduleType: job.schedule.type,
    scheduleValue: job.schedule.at || job.schedule.every || job.schedule.cron || "",
    payloadType: job.payload.type,
    eventName: job.payload.eventName || "",
    eventData: job.payload.eventData ? JSON.stringify(job.payload.eventData, null, 2) : "{}",
    agentId: job.payload.agentId || "",
    sessionKey: job.payload.sessionKey || "",
    message: job.payload.message || "",
    enabled: job.enabled,
  };
}

function formToJob(form: JobFormData): Omit<CronJob, "id"> {
  const schedule: CronSchedule = { type: form.scheduleType };
  if (form.scheduleType === "at") schedule.at = form.scheduleValue;
  else if (form.scheduleType === "every") schedule.every = form.scheduleValue;
  else schedule.cron = form.scheduleValue;

  const payload: CronPayload = { type: form.payloadType };
  if (form.payloadType === "systemEvent") {
    payload.eventName = form.eventName;
    try {
      payload.eventData = JSON.parse(form.eventData);
    } catch {
      payload.eventData = {};
    }
  } else {
    payload.agentId = form.agentId;
    payload.sessionKey = form.sessionKey;
    payload.message = form.message;
  }

  return { name: form.name, schedule, payload, enabled: form.enabled };
}

function JobFormPanel({
  initial,
  onSubmit,
  onCancel,
  title,
}: {
  initial: JobFormData;
  onSubmit: (data: JobFormData) => void;
  onCancel: () => void;
  title: string;
}) {
  const [form, setForm] = useState<JobFormData>(initial);
  const set = <K extends keyof JobFormData>(k: K, v: JobFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const inputClass =
    "w-full px-3 py-2 rounded bg-muted border border-border text-foreground text-sm focus:outline-none focus:border-ring transition";
  const labelClass = "block text-xs text-muted-foreground mb-1";

  return (
    <div className="border border-border rounded-lg p-4 bg-card/50 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      {/* Name */}
      <div>
        <label className={labelClass}>Name</label>
        <input
          className={inputClass}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="My cron job"
        />
      </div>

      {/* Schedule */}
      <div className="grid grid-cols-[auto_1fr] gap-2 items-end">
        <div>
          <label className={labelClass}>Schedule Type</label>
          <select
            className={inputClass}
            value={form.scheduleType}
            onChange={(e) => set("scheduleType", e.target.value as JobFormData["scheduleType"])}
          >
            <option value="every">Every</option>
            <option value="cron">Cron</option>
            <option value="at">At</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>
            {form.scheduleType === "every"
              ? "Interval (e.g. 30m, 1h)"
              : form.scheduleType === "cron"
                ? "Cron Expression"
                : "ISO DateTime"}
          </label>
          <input
            className={inputClass}
            value={form.scheduleValue}
            onChange={(e) => set("scheduleValue", e.target.value)}
            placeholder={
              form.scheduleType === "every"
                ? "30m"
                : form.scheduleType === "cron"
                  ? "0 9 * * *"
                  : "2026-03-01T09:00:00Z"
            }
          />
        </div>
      </div>

      {/* Payload Type */}
      <div>
        <label className={labelClass}>Payload Type</label>
        <select
          className={inputClass}
          value={form.payloadType}
          onChange={(e) => set("payloadType", e.target.value as JobFormData["payloadType"])}
        >
          <option value="systemEvent">System Event</option>
          <option value="agentTurn">Agent Turn</option>
        </select>
      </div>

      {/* Payload Fields */}
      {form.payloadType === "systemEvent" ? (
        <>
          <div>
            <label className={labelClass}>Event Name</label>
            <input
              className={inputClass}
              value={form.eventName}
              onChange={(e) => set("eventName", e.target.value)}
              placeholder="my.event"
            />
          </div>
          <div>
            <label className={labelClass}>Event Data (JSON)</label>
            <textarea
              className={`${inputClass} h-20 font-mono text-xs`}
              value={form.eventData}
              onChange={(e) => set("eventData", e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={labelClass}>Agent ID</label>
            <input
              className={inputClass}
              value={form.agentId}
              onChange={(e) => set("agentId", e.target.value)}
              placeholder="agent-name"
            />
          </div>
          <div>
            <label className={labelClass}>Session Key (optional)</label>
            <input
              className={inputClass}
              value={form.sessionKey}
              onChange={(e) => set("sessionKey", e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Message</label>
            <textarea
              className={`${inputClass} h-20`}
              value={form.message}
              onChange={(e) => set("message", e.target.value)}
              placeholder="What should the agent do?"
            />
          </div>
        </>
      )}

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded border border-border hover:border-border transition"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(form)}
          disabled={!form.name || !form.scheduleValue}
          className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Run History ────────────────────────────────────────

function RunHistory({ jobId, fetchRuns }: { jobId: string; fetchRuns: (id: string) => Promise<CronRun[]> }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchRuns(jobId);
    setRuns(r);
    setLoading(false);
  }, [jobId, fetchRuns]);

  const toggle = () => {
    if (!open && runs.length === 0) load();
    setOpen((o) => !o);
  };

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <History size={12} />
        Run History
        {loading && <Loader2 size={12} className="animate-spin ml-1" />}
      </button>
      {open && (
        <div className="mt-2 space-y-1 ml-4">
          {runs.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">No runs yet</p>
          )}
          {runs.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  r.status === "ok"
                    ? "bg-emerald-500"
                    : r.status === "error"
                      ? "bg-red-500"
                      : "bg-yellow-500"
                }`}
              />
              <span>{new Date(r.startedAt).toLocaleString()}</span>
              {r.durationMs != null && (
                <span className="text-muted-foreground">{r.durationMs}ms</span>
              )}
              {r.error && <span className="text-destructive truncate max-w-48">{r.error}</span>}
            </div>
          ))}
          {open && (
            <button
              onClick={load}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
            >
              <RefreshCw size={10} /> Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────

export function CronPanel() {
  const { jobs, loading, fetchJobs, addJob, updateJob, removeJob, runJob, fetchRuns } = useCron();

  const [formMode, setFormMode] = useState<"hidden" | "add" | "edit">("hidden");
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [formData, setFormData] = useState<JobFormData>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const markBusy = (id: string) => setBusyIds((s) => new Set(s).add(id));
  const unmarkBusy = (id: string) =>
    setBusyIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });

  const handleAdd = () => {
    setFormData(emptyForm);
    setEditingJob(null);
    setFormMode("add");
  };

  const handleEdit = (job: CronJob) => {
    setFormData(formFromJob(job));
    setEditingJob(job);
    setFormMode("edit");
  };

  const handleFormSubmit = async (data: JobFormData) => {
    try {
      if (formMode === "add") {
        await addJob(formToJob(data));
      } else if (formMode === "edit" && editingJob) {
        const patch = formToJob(data);
        await updateJob(editingJob.id, patch);
      }
      setFormMode("hidden");
    } catch (e) {
      console.error("[CronPanel] save error:", e);
    }
  };

  const handleToggle = async (job: CronJob) => {
    markBusy(job.id);
    try {
      await updateJob(job.id, { enabled: !job.enabled });
    } finally {
      unmarkBusy(job.id);
    }
  };

  const handleRun = async (job: CronJob) => {
    markBusy(job.id);
    try {
      await runJob(job.id);
    } finally {
      unmarkBusy(job.id);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    markBusy(deleteTarget.id);
    try {
      await removeJob(deleteTarget.id);
    } finally {
      unmarkBusy(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Cron Jobs</h2>
          <span className="text-xs text-muted-foreground">({jobs.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobs}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-white rounded transition"
          >
            <Plus size={14} /> Add Job
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Form */}
        {formMode !== "hidden" && (
          <JobFormPanel
            initial={formData}
            onSubmit={handleFormSubmit}
            onCancel={() => setFormMode("hidden")}
            title={formMode === "add" ? "Add Cron Job" : `Edit: ${editingJob?.name}`}
          />
        )}

        {/* Loading */}
        {loading && jobs.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 size={20} className="animate-spin mr-2" />
            Loading…
          </div>
        )}

        {/* Empty */}
        {!loading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Clock size={32} className="mb-2 opacity-40" />
            <p className="text-sm">No cron jobs configured</p>
            <button
              onClick={handleAdd}
              className="mt-3 text-xs text-primary hover:text-primary"
            >
              Create your first job →
            </button>
          </div>
        )}

        {/* Job List */}
        {jobs.map((job) => {
          const busy = busyIds.has(job.id);
          return (
            <div
              key={job.id}
              className={`border rounded-lg p-4 transition ${
                job.enabled
                  ? "border-border bg-card/50"
                  : "border-border bg-card/20 opacity-60"
              }`}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{job.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        job.enabled
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {job.enabled ? "active" : "disabled"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    {scheduleLabel(job.schedule)}
                  </p>
                  {job.lastRunAt && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Last run: {relativeTime(job.lastRunAt)}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(job)}
                    disabled={busy}
                    className="p-1.5 rounded hover:bg-muted transition disabled:opacity-40"
                    title={job.enabled ? "Disable" : "Enable"}
                  >
                    {job.enabled ? (
                      <ToggleRight size={16} className="text-emerald-400" />
                    ) : (
                      <ToggleLeft size={16} className="text-muted-foreground" />
                    )}
                  </button>

                  {/* Run now */}
                  <button
                    onClick={() => handleRun(job)}
                    disabled={busy}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition disabled:opacity-40"
                    title="Run now"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => handleEdit(job)}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => setDeleteTarget(job)}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Payload info */}
              <div className="mt-2 text-[11px] text-muted-foreground">
                {job.payload.type === "systemEvent" ? (
                  <span>Event: {job.payload.eventName || "—"}</span>
                ) : (
                  <span>
                    Agent: {job.payload.agentId || "—"}
                    {job.payload.message && ` · "${job.payload.message.slice(0, 40)}…"`}
                  </span>
                )}
              </div>

              {/* Run History */}
              <RunHistory jobId={job.id} fetchRuns={fetchRuns} />
            </div>
          );
        })}
      </div>

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          message={`Delete cron job "${deleteTarget.name}"? This cannot be undone.`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
