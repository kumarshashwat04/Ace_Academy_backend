/**
 * Certification grouping/derivation logic, ported from the frontend's
 * lib/certifications.ts to operate on certification_levels SQL rows instead
 * of a nested Firestore array. Keep the output shape (module_name / levels[]
 * with score, attemptedTime, noOfAttempts, lastAttemptDate, completedAt)
 * identical to the frontend's CertificationModule/LevelProgress types so the
 * backend-primary/Firebase-fallback swap is transparent to callers.
 */

export type CertificationStatus = "not_started" | "not_attempted" | "in_progress" | "completed" | "locked";

export interface CertificationLevelRow {
  module_name: string;
  level_name: string;
  status: CertificationStatus;
  score: number;
  attempted_time_seconds: number;
  no_of_attempts: number;
  last_attempt_date: Date | string | null;
  completed_at: Date | string | null;
}

export interface LevelProgress {
  level_name: string;
  status: CertificationStatus;
  score: number;
  attemptedTime: number;
  noOfAttempts: number;
  lastAttemptDate: string | null;
  completedAt: string | null;
}

export interface CertificationModule {
  module_name: string;
  levels: LevelProgress[];
}

// Per-module level structure — mirrors ACE-Academy/lib/certifications.ts MODULE_LEVELS.
export const MODULE_LEVELS: { module_name: string; levels: string[] }[] = [
  { module_name: "Ranger RTP", levels: ["PathFinder", "Navigator", "Grand Master"] },
  { module_name: "Ranger TTP", levels: ["PathFinder", "Navigator", "Grand Master"] },
  { module_name: "Tools & Techniques", levels: ["Tools Specialist"] },
];

const normalizedLevelName = (value: unknown) =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, "");

function initialStatusForLevel(levelName: string): CertificationStatus {
  const name = normalizedLevelName(levelName);
  if (name === "toolsspecialist") return "not_attempted";
  if (name === "pathfinder") return "not_started";
  return "locked";
}

/** Rows to insert for a brand-new user, one per module/level combination. */
export function buildInitialCertificationRows(userId: string) {
  return MODULE_LEVELS.flatMap(({ module_name, levels }) =>
    levels.map((level_name) => ({
      user_id: userId,
      module_name,
      level_name,
      status: initialStatusForLevel(level_name),
      score: 0,
      attempted_time_seconds: 0,
      no_of_attempts: 0,
      last_attempt_date: null,
      completed_at: null,
    }))
  );
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Groups flat certification_levels rows into the nested CertificationModule[] shape. */
export function groupCertificationLevels(rows: CertificationLevelRow[]): CertificationModule[] {
  const byModule = new Map<string, LevelProgress[]>();

  for (const row of rows) {
    const levels = byModule.get(row.module_name) ?? [];
    levels.push({
      level_name: row.level_name,
      status: row.status,
      score: row.score,
      attemptedTime: row.attempted_time_seconds,
      noOfAttempts: row.no_of_attempts,
      lastAttemptDate: toIso(row.last_attempt_date),
      completedAt: toIso(row.completed_at),
    });
    byModule.set(row.module_name, levels);
  }

  return Array.from(byModule.entries()).map(([module_name, levels]) => ({ module_name, levels }));
}

const LEVEL_ORDER = ["pathfinder", "navigator", "grandmaster"];

/** Ported from ACE-Academy/lib/certifications.ts getCurrentLevelFromCerts. */
export function getCurrentLevelFromModules(modules: CertificationModule[]): number {
  if (modules.length === 0) return 0;

  let maxLevel = 0;
  LEVEL_ORDER.forEach((levelName, index) => {
    const modulesWithLevel = modules.filter((mod) =>
      mod.levels.some((level) => normalizedLevelName(level.level_name) === levelName)
    );
    const allCompleted =
      modulesWithLevel.length > 0 &&
      modulesWithLevel.every((mod) =>
        mod.levels.some(
          (level) => normalizedLevelName(level.level_name) === levelName && level.status === "completed"
        )
      );
    if (allCompleted) {
      maxLevel = Math.max(maxLevel, index + 1);
    }
  });

  return maxLevel;
}
