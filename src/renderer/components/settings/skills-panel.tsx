"use client";

import { useState, useMemo } from "react";
import {
  RefreshCw,
  Search,
  ExternalLink,
  Download,
  Key,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Package,
  Puzzle,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useSkills, type Skill } from "@/lib/gateway/use-skills";

// --- Source badge ---

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    "openclaw-bundled": { label: "Bundled", variant: "secondary" },
    managed: { label: "Managed", variant: "outline" },
    workspace: { label: "Workspace", variant: "default" },
  };
  const c = map[source] || { label: source, variant: "secondary" as const };
  return <Badge variant={c.variant} className="text-[10px] px-1.5 py-0">{c.label}</Badge>;
}

// --- Status indicator ---

function StatusDot({ skill }: { skill: Skill }) {
  if (skill.disabled) return <span className="h-2 w-2 rounded-full bg-muted-foreground" title="Disabled" />;
  if (!skill.eligible) return <span className="h-2 w-2 rounded-full bg-amber-500" title="Not eligible" />;
  return <span className="h-2 w-2 rounded-full bg-emerald-500" title="Active" />;
}

// --- API Key input ---

function ApiKeyInput({ onSave }: { onSave: (key: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (!editing) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-6 gap-1 text-xs text-muted-foreground">
        <Key className="h-3 w-3" />
        API Key
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter API key..."
        className="h-7 w-48 rounded-md border bg-background px-2 text-xs focus:border-ring focus:outline-none"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onSave(value.trim());
            setEditing(false);
            setValue("");
          }
          if (e.key === "Escape") {
            setEditing(false);
            setValue("");
          }
        }}
      />
      <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-500" onClick={() => { if (value.trim()) { onSave(value.trim()); setEditing(false); setValue(""); } }}>
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditing(false); setValue(""); }}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// --- Skill card ---

function SkillCard({
  skill,
  onToggle,
  onApiKey,
  onInstall,
}: {
  skill: Skill;
  onToggle: (enabled: boolean) => void;
  onApiKey: (key: string) => void;
  onInstall: (installId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMissing =
    skill.missing.bins.length > 0 ||
    skill.missing.anyBins.length > 0 ||
    skill.missing.env.length > 0 ||
    skill.missing.config.length > 0;

  return (
    <div className="rounded-lg border bg-card transition-colors hover:border-border/80">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg">{skill.emoji || "🔧"}</span>
          <StatusDot skill={skill} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{skill.name}</span>
            <SourceBadge source={skill.source} />
            {skill.homepage && (
              <a href={skill.homepage} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{skill.description}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {skill.primaryEnv && <ApiKeyInput onSave={onApiKey} />}
          <Switch checked={!skill.disabled} onCheckedChange={(v) => onToggle(v)} />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-2 text-xs">
          {(skill.requirements.bins.length > 0 || skill.requirements.env.length > 0) && (
            <div>
              <span className="text-muted-foreground font-medium">Requirements:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {skill.requirements.bins.map((b) => (
                  <Badge key={b} variant={skill.missing.bins.includes(b) ? "destructive" : "secondary"} className="text-[10px]">
                    {skill.missing.bins.includes(b) ? "✗" : "✓"} {b}
                  </Badge>
                ))}
                {skill.requirements.env.map((e) => (
                  <Badge key={e} variant={skill.missing.env.includes(e) ? "destructive" : "secondary"} className="text-[10px]">
                    {skill.missing.env.includes(e) ? "✗" : "✓"} {e}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {hasMissing && (
            <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Missing: {[...skill.missing.bins, ...skill.missing.anyBins, ...skill.missing.env, ...skill.missing.config].join(", ")}
              </span>
            </div>
          )}

          {skill.install.length > 0 && hasMissing && (
            <div className="flex flex-wrap gap-2">
              {skill.install.map((inst) => (
                <Button key={inst.id} variant="secondary" size="sm" onClick={() => onInstall(inst.id)} className="h-7 gap-1 text-xs">
                  <Download className="h-3 w-3" />
                  {inst.label}
                </Button>
              ))}
            </div>
          )}

          <div className="text-muted-foreground">
            <span className="font-medium">Path:</span>{" "}
            <span className="font-mono text-[10px]">{skill.filePath}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Filter tabs ---

type FilterTab = "all" | "active" | "disabled" | "missing";

// --- Main Panel ---

export function SkillsPanel() {
  const { skills, loading, error, refresh, toggleSkill, setApiKey, installSkill } = useSkills();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");

  const filtered = useMemo(() => {
    let result = skills;
    switch (tab) {
      case "active": result = result.filter((s) => s.eligible && !s.disabled); break;
      case "disabled": result = result.filter((s) => s.disabled); break;
      case "missing": result = result.filter((s) => s.missing.bins.length > 0 || s.missing.anyBins.length > 0 || s.missing.env.length > 0); break;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.skillKey.toLowerCase().includes(q));
    }
    return result;
  }, [skills, tab, search]);

  const counts = useMemo(() => ({
    all: skills.length,
    active: skills.filter((s) => s.eligible && !s.disabled).length,
    disabled: skills.filter((s) => s.disabled).length,
    missing: skills.filter((s) => s.missing.bins.length > 0 || s.missing.anyBins.length > 0 || s.missing.env.length > 0).length,
  }), [skills]);

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "active", label: "Active", count: counts.active },
    { key: "disabled", label: "Disabled", count: counts.disabled },
    { key: "missing", label: "Missing deps", count: counts.missing },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Skills</h2>
          <Badge variant="secondary" className="text-[10px]">{counts.active}/{counts.all}</Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} disabled={loading} className="h-8 w-8">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Search + Tabs */}
      <div className="space-y-2 border-b px-4 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="h-8 w-full rounded-md border bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {tabs.map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab(t.key)}
              className="h-7 text-xs"
            >
              {t.label}
              <span className="ml-1 text-[10px] opacity-60">{t.count}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {loading && skills.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading skills...</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">No skills found</div>
        ) : (
          filtered.map((skill) => (
            <SkillCard
              key={skill.skillKey}
              skill={skill}
              onToggle={(enabled) => toggleSkill(skill.skillKey, enabled)}
              onApiKey={(key) => setApiKey(skill.skillKey, key)}
              onInstall={(installId) => installSkill(skill.name, installId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
