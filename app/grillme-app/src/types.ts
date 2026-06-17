export interface GrillmeState {
  version: number;
  project: string;
  phase: string;
  phase_num: number;
  started_at: string;
  hackathon_hours: number;
  plan_file?: string;
  current_step?: number;
  total_steps?: number;
  last_codex_run?: string;
}

export interface StateChangedPayload {
  file: string;
  content: string;
}

export interface VersionMismatchPayload {
  version: unknown;
}

export type PaneName =
  | "projects"
  | "claude-web"
  | "timeline"
  | "search"
  | "memory"
  | "cost"
  | "voice"
  | "overview"
  | "chat"
  | "timer"
  | "plan"
  | "learn"
  | "codex";
