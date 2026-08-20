"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { toggleSkill } from "@/lib/skills/actions";

/** 启停开关：调 server action 真启停（目录搬移），乐观更新，失败回滚并提示原因。 */
export function SkillToggle({ name, enabled }: { readonly name: string; readonly enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(next: boolean) {
    setBusy(true);
    setError(null);
    setOn(next); // 乐观更新
    const result = await toggleSkill(name, next);
    if (!result.ok) {
      setOn(!next); // 失败回滚
      setError(result.error);
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      {error ? (
        <span className="inline-flex max-w-[180px] items-center gap-1 rounded-lg border border-[#b66a4b]/25 bg-[#fff5ee] px-2 py-1 text-[9px] text-[#a75c3e]" role="alert">
          <CircleAlert className="size-2.5 shrink-0" />
          <span className="truncate">{error}</span>
        </span>
      ) : null}
      <button
        aria-label={`${on ? "停用" : "启用"}技能 ${name}`}
        aria-pressed={on}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          on ? "bg-[#6f9a50]" : "bg-black/14"
        } ${busy ? "opacity-60" : ""}`}
        disabled={busy}
        onClick={() => void handleToggle(!on)}
        type="button"
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition ${
            on ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </span>
  );
}
