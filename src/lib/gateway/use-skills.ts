"use client";

import { useState, useCallback, useEffect } from "react";
import { useGateway } from "./hooks";

// --- Types ---

export interface SkillRequirements {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
}

export interface SkillInstaller {
  id: string;
  kind: string; // "brew" | "node" | "go" | "uv" | "download"
  label: string;
  bins?: string[];
  formula?: string;
  package?: string;
  os?: string[];
}

export interface Skill {
  name: string;
  description: string;
  source: string; // "openclaw-bundled" | "managed" | "workspace"
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: SkillRequirements;
  missing: SkillRequirements;
  configChecks: string[];
  install: SkillInstaller[];
  primaryEnv?: string;
  hasApiKey?: boolean;
}

// --- Hook ---

export function useSkills() {
  const { client, state } = useGateway();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.request<{ skills: Skill[] }>("skills.status", {});
      setSkills(res?.skills || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [client, state]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const toggleSkill = useCallback(
    async (skillKey: string, enabled: boolean) => {
      if (!client || state !== "connected") return;
      try {
        await client.request("skills.update", { skillKey, enabled });
        // Optimistic update
        setSkills((prev) =>
          prev.map((s) =>
            s.skillKey === skillKey ? { ...s, disabled: !enabled } : s
          )
        );
      } catch (err) {
        setError(String(err));
        // Revert on error
        await fetchSkills();
      }
    },
    [client, state, fetchSkills]
  );

  const setApiKey = useCallback(
    async (skillKey: string, apiKey: string) => {
      if (!client || state !== "connected") return;
      try {
        await client.request("skills.update", { skillKey, apiKey });
        await fetchSkills();
      } catch (err) {
        setError(String(err));
      }
    },
    [client, state, fetchSkills]
  );

  const installSkill = useCallback(
    async (name: string, installId: string) => {
      if (!client || state !== "connected") return;
      try {
        await client.request("skills.install", {
          name,
          installId,
          timeoutMs: 120_000,
        });
        await fetchSkills();
      } catch (err) {
        setError(String(err));
      }
    },
    [client, state, fetchSkills]
  );

  return {
    skills,
    loading,
    error,
    refresh: fetchSkills,
    toggleSkill,
    setApiKey,
    installSkill,
  };
}
