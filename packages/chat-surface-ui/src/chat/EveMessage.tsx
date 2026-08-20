"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage as EveMessageType,
  EveMessagePart,
} from "eve/react";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { memo } from "react";
import type { AgentInputResponse, ChatRenderers } from "../adapters/renderers";
import { useEveChatRenderers } from "../core/contexts";
import { Message, MessageContent, MessageResponse } from "../ai-elements/message";
import { TextWithLinks } from "../ai-elements/text-with-links";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { Button } from "../ui/button";
import { cn } from "../lib/cn";
import { normalizeMessageParts } from "../lib/normalize-message-parts";

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;

export const EveMessage = memo(
  function EveMessage({
    canRespond,
    isStreaming,
    message,
    onInputResponses,
    renderers,
  }: {
    readonly canRespond: boolean;
    readonly isStreaming: boolean;
    readonly message: EveMessageType;
    readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
    /** 可选：覆盖 Provider/Plugin 注入的 renderers。 */
    readonly renderers?: ChatRenderers;
  }) {
    const parts = normalizeMessageParts(message.parts);
    const lastTextIndex = parts.reduce(
      (last, part, index) => (part.type === "text" ? index : last),
      -1,
    );

    return (
      <Message
        data-optimistic={message.metadata?.optimistic ? "true" : undefined}
        from={message.role}
      >
        <MessageContent>
          {parts.map((part, index) => (
            <EveMessagePartView
              canRespond={canRespond}
              key={partKey(part, index)}
              message={message}
              onInputResponses={onInputResponses}
              part={part}
              renderers={renderers}
              showCaret={isStreaming && message.role === "assistant" && index === lastTextIndex}
            />
          ))}
        </MessageContent>
      </Message>
    );
  },
  // eve store 为不可变更新：流式事件只替换被更新的那条消息，
  // 历史消息引用稳定 —— 据此跳过历史消息的 markdown 重解析，
  // 避免长对话流式期间整棵树反复重建（卡顿感的主要来源之一）。
  // onInputResponses 是 agent.respond 的内联包装，每次渲染都是新
  // 引用且语义恒定（同一 store），比较时忽略以免 memo 永远失效。
  (prev, next) =>
    prev.message === next.message &&
    prev.canRespond === next.canRespond &&
    prev.isStreaming === next.isStreaming,
);

EveMessage.displayName = "EveMessage";

function EveMessagePartView({
  canRespond,
  message,
  onInputResponses,
  part,
  renderers: renderersProp,
  showCaret,
}: {
  readonly canRespond: boolean;
  readonly message: EveMessageType;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly renderers?: ChatRenderers;
  readonly showCaret: boolean;
}) {
  const contextRenderers = useEveChatRenderers();
  const renderers = renderersProp ?? contextRenderers;

  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {TextWithLinks({ text: part.text })}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return <AttachmentPart part={part} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool": {
      const visual =
        part.state === "output-available" && renderers.renderPartExtra
          ? renderers.renderPartExtra({
              canRespond,
              message,
              onInputResponses,
              part,
            })
          : null;
      return (
        <Tool
          defaultOpen={
            part.state === "approval-requested" ||
            part.state === "approval-responded" ||
            // 评估报告/评审需要人工查看与标注 —— 默认展开，不折叠
            part.toolName === "run_skill_evals"
          }
        >
          <ToolHeader
            state={part.state}
            title={part.toolName}
            toolName={part.toolName}
            type="dynamic-tool"
            toolCallId={part.toolCallId}
          />
          <ToolContent>
            {/* ask_question 的输入参数即询问 UI 本身：prompt/options 已由
                InputRequestActions 渲染，不再展示参数 JSON，避免技术噪音。 */}
            {part.toolName !== "ask_question" ? <ToolInput input={part.input} /> : null}
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
            {visual ?? <ToolOutput errorText={part.errorText} output={part.output} />}
          </ToolContent>
        </Tool>
      );
    }
  }
}

function AttachmentPart({ part }: { readonly part: EveFilePart }) {
  const label = part.filename ?? "附件";
  const detail = [part.mediaType, formatBytes(part.size)].filter(Boolean).join(" - ");
  const isImage = part.mediaType.startsWith("image/") && part.url !== undefined;
  // generative UI 路由：HTML 附件（评估报告/图表/看板）直接 iframe 内联渲染，而非只给下载链接
  const isHtml = part.mediaType === "text/html" && part.url !== undefined;
  const Icon = isImage ? ImageIcon : FileIcon;
  const body = (
    <span className="flex max-w-sm items-center gap-3 rounded-md border bg-background/60 p-2 text-sm">
      {isImage ? (
        <img alt={label} className="size-12 shrink-0 rounded-sm object-cover" src={part.url} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail ? <span className="block truncate text-muted-foreground">{detail}</span> : null}
      </span>
      {part.url ? <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
    </span>
  );

  if (isHtml && part.url) {
    return (
      <details className="overflow-hidden rounded-xl border border-black/7 bg-white/50" open>
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-black/70">
          {label}
        </summary>
        <iframe
          className="h-[420px] w-full rounded-b-xl border-t border-black/7 bg-white"
          sandbox=""
          src={part.url}
          title={label}
        />
      </details>
    );
  }

  return part.url ? (
    <a href={part.url} rel="noreferrer" target="_blank">
      {body}
    </a>
  ) : (
    body
  );
}

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-md border p-3",
        isAuthorized
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/30 bg-destructive/5"
            : "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-muted-foreground text-sm">{authorizationDescription(part)}</p>
          {shouldShowInstructions ? (
            <p className="text-muted-foreground text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">授权码</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                前往 {part.displayName} 授权
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `连接 ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `已连接 ${part.displayName}`;
  }
  return `${part.displayName} 授权${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `需要连接 ${part.displayName} 以继续`;
  }
  if (part.outcome === "authorized") {
    return `已连接 ${part.displayName}。`;
  }
  const tail = part.reason !== undefined ? `（${part.reason}）` : "";
  return `${part.displayName} 授权${formatAuthorizationOutcome(part.outcome)}${tail}。`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "已授权";
    case "declined":
      return "已拒绝";
    case "failed":
      return "失败";
    case "timed-out":
      return "超时";
  }
}

function formatBytes(size: number | undefined): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <p className="text-muted-foreground text-sm">{inputRequest.prompt}</p>
      {inputResponse ? (
        <p className="font-medium text-sm">
          已选择：{selectedOption?.label ?? inputResponse.text ?? inputResponse.optionId}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
