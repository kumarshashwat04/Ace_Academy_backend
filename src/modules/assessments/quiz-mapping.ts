/**
 * Ported from ACE-Academy/lib/assessment-mapping.ts + lib/academy-data.ts.
 * Maps a quizId like "rtp-pathfinder" to the certification_levels
 * (module_name, level_name) it corresponds to.
 */

type CertId = "pathfinder" | "navigator" | "grandmaster" | "toolscert";

const PRODUCTS: { id: string; name: string; certs: CertId[] }[] = [
  { id: "rtp", name: "Ranger RTP", certs: ["pathfinder", "navigator", "grandmaster"] },
  { id: "ttp", name: "Ranger TTP", certs: ["pathfinder", "navigator", "grandmaster"] },
  { id: "tools", name: "Tools & Techniques", certs: ["toolscert"] },
];

const CERT_NAME: Record<CertId, string> = {
  pathfinder: "PathFinder",
  navigator: "Navigator",
  grandmaster: "Grand Master",
  toolscert: "Tools Specialist",
};

const CERT_TO_QUIZ_LEVEL: Record<CertId, string> = {
  pathfinder: "pathfinder",
  navigator: "navigator",
  grandmaster: "grandmaster",
  toolscert: "specialist",
};

const QUIZ_LEVEL_TO_CERT: Record<string, CertId> = Object.fromEntries(
  Object.entries(CERT_TO_QUIZ_LEVEL).map(([certId, quizLevel]) => [quizLevel, certId as CertId])
) as Record<string, CertId>;

export const VALID_QUIZ_IDS = PRODUCTS.flatMap((product) =>
  product.certs.map((certId) => `${product.id}-${CERT_TO_QUIZ_LEVEL[certId]}`)
);

export type ParsedQuizId = {
  moduleName: string;
  levelName: string;
};

export function parseQuizId(quizId: string): ParsedQuizId | null {
  const parts = quizId.split("-");
  if (parts.length < 2) return null;

  const levelSegment = parts[parts.length - 1];
  const productId = parts.slice(0, -1).join("-");

  const certId = QUIZ_LEVEL_TO_CERT[levelSegment];
  if (!certId) return null;

  const product = PRODUCTS.find((entry) => entry.id === productId);
  if (!product || !product.certs.includes(certId)) return null;

  return { moduleName: product.name, levelName: CERT_NAME[certId] };
}

const LEVEL_ORDER: CertId[] = ["pathfinder", "navigator", "grandmaster"];

const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");

/** Next tiered level name after `currentLevelName` (null past Grand Master, or for the standalone Tools cert). */
export function getNextLevelName(currentLevelName: string): string | null {
  const currentNorm = normalized(currentLevelName);
  const index = LEVEL_ORDER.findIndex((id) => normalized(CERT_NAME[id]) === currentNorm);
  if (index < 0 || index >= LEVEL_ORDER.length - 1) return null;
  return CERT_NAME[LEVEL_ORDER[index + 1]];
}
