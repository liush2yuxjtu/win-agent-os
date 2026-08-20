"use client";

import { cn } from "../lib/cn";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SkillDescriptor } from "../adapters/skills";
import { usePromptInputController } from "./prompt-input";

/**
 * 技能斜杠命令补全（/ai-control 式输入）：
 *
 * 在 PromptInput 输入框打字时，若当前正在输入一个以 `/` 开头的词
 * （`/` 之后还没有空格），就在输入框上方弹出启用中的技能列表，
 * ↑↓ 选择、Enter 补全为 `/技能名 `，Esc 或失焦关闭。
 *
 * 发送侧（expandSlashCommand）会把 `/技能名 任务` 翻译成
 * 「请加载并使用 x 技能，任务：…」——eve 对直接点名技能会触发 load_skill，
 * 显式指令化保证命中，避免模型把斜杠当作无关符号忽略。
 *
 * 技能列表由消费方通过 `skills` adapter 传入（web 侧来自
 * lib/skills/registry.json；standalone 侧可为空列表），包内不读任何
 * 文件系统或静态 JSON。
 *
 * 依赖 PromptInputProvider（usePromptInputController 提供受控 text/value），
 * 由使用方（EveChatPlugin）包裹。
 */
export function SkillSlashMenu({ skills = [] }: { readonly skills?: readonly SkillDescriptor[] }) {
  const controller = usePromptInputController();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);

  const text = controller.textInput.value;
  const availableSkills = useMemo(
    () => skills.filter((s) => s.enabled && !s.metadata?.internal),
    [skills],
  );

  // 当前是否正在输入一个 / 开头的词（/ 之后无空格）
  const slashMatch = text.match(/(?:^|\s)\/([a-z0-9_-]*)$/i);
  const query = slashMatch?.[1] ?? null;
  const matches = useMemo(() => {
    if (query === null) {
      return [];
    }
    const q = query.toLowerCase();
    return availableSkills
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [availableSkills, query]);

  useEffect(() => {
    if (query !== null && matches.length > 0) {
      setOpen(true);
      setSelected(0);
    } else {
      setOpen(false);
    }
  }, [query, matches.length]);

  const apply = useCallback(
    (name: string) => {
      // 替换正在输入的 /词（保留其前文），补全为 /name + 空格
      const prefix = text.slice(0, text.lastIndexOf("/"));
      controller.textInput.setInput(`${prefix}/${name} `);
      setOpen(false);
    },
    [text, controller],
  );

  // 菜单打开时在 capture 阶段拦截键盘事件（先于 React 合成事件/form 提交）
  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSelected((i) => (i + 1) % matches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setSelected((i) => (i - 1 + matches.length) % matches.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const picked = matches[selected];
        if (picked) {
          apply(picked.name);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, matches, selected, apply]);

  if (!open) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-black/8 bg-white shadow-[0_8px_28px_rgba(32,36,31,.12)]">
      {matches.map((skill, i) => (
        <button
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
            i === selected && "bg-black/4",
          )}
          key={skill.name}
          // 用 onMouseDown：先于 textarea 失焦触发，避免 blur 抢先关闭菜单
          onMouseDown={(e) => {
            e.preventDefault();
            apply(skill.name);
          }}
          onMouseEnter={() => setSelected(i)}
          type="button"
        >
          <span className="shrink-0 rounded-md bg-black/6 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-black/75">
            /{skill.name}
          </span>
          <span className="truncate text-xs text-black/55">{skill.description}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * 把 `/技能名 任务` 形式的输入翻译成显式技能指令：
 * - `/ai-control` → 「请加载并使用 ai-control 技能」
 * - `/ai-control 看看追投` → 「请加载并使用 ai-control 技能，任务：看看追投」
 * 非斜杠命令原样返回。
 */
export function expandSlashCommand(text: string): string {
  const match = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return text;
  }
  const [, name, rest] = match;
  const task = rest?.trim();
  return task
    ? `请加载并使用 ${name} 技能，任务：${task}`
    : `请加载并使用 ${name} 技能`;
}
