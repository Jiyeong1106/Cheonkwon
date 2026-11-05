export const BELTS = [
  { value: "white", label: "흰띠", color: "#f4f6f8" },
  { value: "yellow", label: "노란띠", color: "#e9bc43" },
  { value: "blue", label: "파란띠", color: "#5c8ec3" },
  { value: "red", label: "빨간띠", color: "#ce7772" },
  { value: "black", label: "검은띠", color: "#354252" },
] as const;

export type Belt = typeof BELTS[number]["value"];
export type MemberRank = { belt: Belt; dan: number };
export type RankSource = { entryId: string; examDate: string };

export function validRank(rank: MemberRank): boolean {
  return BELTS.some(belt => belt.value === rank.belt)
    && Number.isInteger(rank.dan)
    && rank.dan >= (rank.belt === "black" ? 1 : 0) && rank.dan <= 9;
}

export function rankLabel(rank?: MemberRank | null): string {
  if (!rank) return "미등록";
  const label = BELTS.find(belt => belt.value === rank.belt)?.label ?? "미등록";
  return rank.dan ? `${label} · 보유 ${rank.dan}단` : label;
}

export function suggestedRank(rank?: MemberRank | null): MemberRank {
  if (!rank) return { belt: "white", dan: 0 };
  if (rank.belt === "black") return rank;
  // Only a suggestion: the administrator confirms the target for each application.
  const next = BELTS[BELTS.findIndex(belt => belt.value === rank.belt) + 1] ?? BELTS[0];
  return { belt: next.value, dan: rank.dan };
}
