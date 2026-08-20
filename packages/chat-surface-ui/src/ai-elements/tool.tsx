"use client";

import { Badge } from "../ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { cn } from "../lib/cn";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
  /** 工具调用 ID：执行中计时器用它持久化计时起点（重挂载不归零）。 */
  toolCallId?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "等待确认",
  "approval-responded": "已确认",
  "input-available": "执行中",
  "input-streaming": "排队中",
  "output-available": "已完成",
  "output-denied": "已拒绝",
  "output-error": "出错",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

/**
 * 执行中计时器：工具"执行中"从第一次见到它（首次渲染）起实时计时（已运行 Ns），
 * 让用户区分「正在跑」与「卡死」——计时器在跳 = 前端活着，等结果即可。
 *
 * 计时起点按 toolCallId 持久化在 module 级 Map：消息流式重渲染、折叠面板
 * 展开收起导致组件重挂载时不会归零（此前以组件挂载为起点，重挂即重置，
 * 看起来"假"）。页面刷新后历史工具已不在执行中状态，不计时，无需清理。
 */
const toolStartTimes = new Map<string, number>();

function ElapsedTimer({ toolCallId }: { readonly toolCallId?: string }) {
  const [seconds, setSeconds] = useState(() => {
    if (!toolCallId) return 0;
    const existing = toolStartTimes.get(toolCallId);
    if (existing !== undefined) return Math.floor((Date.now() - existing) / 1000);
    toolStartTimes.set(toolCallId, Date.now());
    return 0;
  });
  useEffect(() => {
    if (!toolCallId) return;
    const id = setInterval(() => {
      const start = toolStartTimes.get(toolCallId);
      if (start !== undefined) setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [toolCallId]);
  const label = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return (
    <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums" title="工具开始执行后的已运行时间">
      已运行 {label}
    </span>
  );
}

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  toolCallId,
  ...props
}: ToolHeaderProps) => {
  const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn("flex w-full items-center justify-between gap-4 p-3", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
        {state === "input-available" && (
          <>
            <ElapsedTimer toolCallId={toolCallId} />
            {derivedName.includes("run_skill_evals") && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                正在评估（真实 agent 逐例执行中）…
              </span>
            )}
          </>
        )}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      参数
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "错误" : "结果"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-foreground",
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
