"use client";

import { BELTS, rankLabel, type MemberRank } from "@/lib/member-rank";

export function RankBadge({ rank }: { rank?: MemberRank | null }) {
  const belt = BELTS.find(item => item.value === rank?.belt);
  return <span className="rank-badge">{belt && <i style={{ backgroundColor: belt.color }} aria-hidden="true"/>}{rankLabel(rank)}</span>;
}

export default function RankFields({ value, onChange, optional = false, disabled = false }: {
  value: MemberRank | null; onChange: (rank: MemberRank | null) => void; optional?: boolean; disabled?: boolean;
}) {
  return <div className="form-row rank-fields">
    <label className="form-field"><span>도장 내 띠</span><div className="select-wrap"><select disabled={disabled} value={value?.belt ?? ""} onChange={event => onChange(event.target.value ? { belt: event.target.value as MemberRank["belt"], dan: event.target.value === "black" ? Math.max(1, value?.dan ?? 0) : value?.dan ?? 0 } : null)}>
      {optional && <option value="">미등록</option>}{BELTS.map(belt => <option value={belt.value} key={belt.value}>{belt.label}</option>)}
    </select></div></label>
    <label className="form-field"><span>보유 단수</span><div className="select-wrap"><select disabled={disabled || !value} value={value?.dan ?? 0} onChange={event => value && onChange({ ...value, dan: Number(event.target.value) })}>
      {value?.belt !== "black" && <option value={0}>없음 / 미등록</option>}{[1,2,3,4,5,6,7,8,9].map(dan => <option key={dan} value={dan}>{dan}단</option>)}
    </select></div></label>
  </div>;
}
