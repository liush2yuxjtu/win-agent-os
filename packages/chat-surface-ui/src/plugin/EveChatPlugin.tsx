"use client";

import { AlertCircleIcon, Bot, LayoutDashboardIcon, Maximize2Icon, Sparkles } from "lucide-react";
import { startTransition, useContext, useMemo } from "react";
import type { EveMessageData, UseEveAgentOptions, UseEveAgentStatus } from "eve/react";
import type { ChatHistoryAdapter } from "../adapters/history";
import type { NavigationAdapter } from "../adapters/navigation";
import type { ChatRenderers } from "../adapters/renderers";
import type { SkillDescriptor } from "../adapters/skills";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
} from "../ai-elements/prompt-input";
import { expandSlashCommand, SkillSlashMenu } from "../ai-elements/skill-slash-menu";
import { ChatHistoryPanel } from "../chat/ChatHistoryPanel";
import { EveMessage } from "../chat/EveMessage";
import { cn } from "../lib/cn";
import { ChatRootContext } from "../core/chat-root-context";
import { useChatContext, type WorkspaceMode } from "../core/chat-context";
import { EveChatRoot } from "../core/EveChatRoot";
import {
  EveChatAdaptersContext,
  EveChatRenderersContext,
  useEveChatAdapters,
  useEveChatRenderers,
} from "../core/contexts";
import {
  normalChatPlugin,
  resolveSurfacePlugin,
  type SurfacePlugin,
  type SurfaceProfile,
} from "./SurfacePlugin";

const AGENT_NAME = "经营分析助手";
/** 静态开局推荐：看板查询与技能创作（不随技能注册表变化）。 */
const BASE_SUGGESTIONS = [
  "查看近 7 日经营概况",
  "分析高消耗素材的 ROI",
  "看看近 7 日成交与消耗走势",
  "查某品线的 ROI 基线与日消耗门槛",
  "帮我创建一个新技能",
  "上架我刚写好的技能",
];

type AgentStatus = UseEveAgentStatus;

export type EveChatPluginProps = {
  readonly variant?: "sidebar" | "fullscreen";
  readonly suggestions?: string[];
  readonly standalone?: boolean;
  /** eve 客户端 base URL（同源默认 ""；独立 surface 可传绝对 origin）。 */
  readonly host?: string;
  /** surface 装配 profile，传给 SurfacePlugin。 */
  readonly profile?: SurfaceProfile;
  /** fixture 回放：直接注入会话事件前缀（不经过服务端恢复）。 */
  readonly initialEvents?: UseEveAgentOptions<EveMessageData>["initialEvents"];
  readonly initialSession?: UseEveAgentOptions<EveMessageData>["initialSession"];
  /** 追加/覆盖默认 normal-chat 插件（按顺序优先匹配）。 */
  readonly plugins?: SurfacePlugin[];
  /** 消费方装配的 adapters。 */
  readonly adapters?: {
    readonly history?: ChatHistoryAdapter;
    readonly navigation?: NavigationAdapter;
    readonly skills?: readonly SkillDescriptor[];
  };
  /** 消费方注入的工具产物渲染器（render_ui / qc 查询 / 评估报告等）。 */
  readonly renderers?: ChatRenderers;
  /** 覆盖内置静态开局推荐。 */
  readonly baseSuggestions?: string[];
};

/**
 * 聊天 surface 插件（原 app/_components/agent-chat.tsx 的包内版本）：
 * - 如果已经在 EveChatRoot 内，直接渲染聊天 UI（与其它 surface 共享会话）；
 * - 独立使用时自动包一层 EveChatRoot，让包可以脱离 Next.js 单独测试。
 */
export function EveChatPlugin(props: EveChatPluginProps) {
  const parentRoot = useContext(ChatRootContext);

  if (parentRoot) {
    return <EveChatPluginView {...props} />;
  }

  return (
    <EveChatRoot
      host={props.host}
      standalone={props.standalone}
      adapters={props.adapters}
      initialEvents={props.initialEvents}
      initialSession={props.initialSession}
    >
      <EveChatPluginView {...props} />
    </EveChatRoot>
  );
}

function EveChatPluginView({
  variant = "sidebar",
  suggestions,
  standalone = false,
  profile = "web",
  plugins,
  adapters,
  renderers,
  baseSuggestions,
}: EveChatPluginProps) {
  const parentAdapters = useEveChatAdapters();
  const parentRenderers = useEveChatRenderers();

  const mergedAdapters = useMemo(
    () => ({
      history: adapters?.history ?? parentAdapters.history,
      navigation: adapters?.navigation ?? parentAdapters.navigation,
      skills: adapters?.skills ?? parentAdapters.skills,
    }),
    [
      adapters?.history,
      adapters?.navigation,
      adapters?.skills,
      parentAdapters.history,
      parentAdapters.navigation,
      parentAdapters.skills,
    ],
  );
  const mergedRenderers = renderers ?? parentRenderers;

  const surfaceCtx = useMemo(
    () => ({
      profile,
      view: "chat" as const,
      adapters: mergedAdapters,
      renderers: mergedRenderers,
    }),
    [profile, mergedAdapters, mergedRenderers],
  );
  const override = resolveSurfacePlugin(
    [normalChatPlugin, ...(plugins ?? [])],
    "chat",
    surfaceCtx,
  );

  return (
    <EveChatAdaptersContext.Provider value={mergedAdapters}>
      <EveChatRenderersContext.Provider value={mergedRenderers}>
        {override ?? (
          <AgentChatSurface
            baseSuggestions={baseSuggestions}
            standalone={standalone}
            suggestions={suggestions}
            variant={variant}
          />
        )}
      </EveChatRenderersContext.Provider>
    </EveChatAdaptersContext.Provider>
  );
}

/**
 * 聊天面板的两种呈现：侧栏（dashboard 布局内）与全屏 AI 聊天。
 * 两种变体消费同一个 ChatProvider 的会话状态 —— 切换变体不重置任何聊天状态。
 *
 * `suggestions`：动态开局推荐（来自技能注册表，启用且声明 suggest 的技能各一条）；
 * 与静态推荐合并渲染（去重）。
 *
 * `standalone`：会话深链独立页（/chat/<sessionId>）——「返回看板」不仅切回
 * dashboard 模式，还要真正离开 /chat/<id> URL 回到首页。
 */
function AgentChatSurface({
  variant = "sidebar",
  suggestions,
  standalone = false,
  baseSuggestions,
}: {
  readonly variant?: "sidebar" | "fullscreen";
  readonly suggestions?: string[];
  readonly standalone?: boolean;
  readonly baseSuggestions?: string[];
}) {
  const {
    agent,
    setMode,
    hasConversation,
    localGreeting,
    errorMessage,
    isBusy,
    requestCancellation,
    handleSubmit,
  } = useChatContext();
  const { navigation } = useEveChatAdapters();
  const { skills = [] } = useEveChatAdapters();
  const isFullscreen = variant === "fullscreen";

  const handleSlashSubmit = useMemo(
    () => (message: PromptInputMessage) =>
      handleSubmit({ ...message, text: expandSlashCommand(message.text) }),
    [handleSubmit],
  );

  const mergedSuggestions = useMemo(
    () =>
      [...(baseSuggestions ?? BASE_SUGGESTIONS), ...(suggestions ?? [])].filter(
        (value, index, all) => all.indexOf(value) === index,
      ),
    [baseSuggestions, suggestions],
  );

  // 全屏/看板切换重建整棵布局树（DualModeShell），标记为低优先级更新，
  // 避免切换瞬间阻塞输入与流式渲染（rerender-transitions）。
  // 深链独立页（standalone）的「返回看板」还要离开 /chat/<id> URL 回首页，
  // 否则刷新仍会回到深链页。
  const handleToggleMode = () => {
    if (isFullscreen && standalone) {
      startTransition(() => setMode("dashboard"));
      navigation?.replace("/");
      return;
    }
    startTransition(() => setMode(isFullscreen ? "dashboard" : "fullscreen"));
  };

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-[#fbfaf6] text-[#1e211d]",
        isFullscreen ? "h-dvh" : "h-full",
      )}
    >
      <header
        className={cn(
          "relative z-10 flex h-[76px] shrink-0 items-center justify-between border-b border-black/7 px-5",
          isFullscreen && "bg-[#fbfaf6]/95 backdrop-blur-lg",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="relative grid size-9 place-items-center rounded-xl bg-[#20241f] text-[#d7ff5f] shadow-sm">
            <Bot className="size-[17px]" />
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[#fbfaf6] bg-[#7cad58]" />
          </span>
          <div>
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold tracking-[-0.025em]">{AGENT_NAME}</h2><StatusDot status={agent.status} /></div>
            <p className="mt-0.5 text-[10px] text-black/58">你的经营数据分析助手</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 全屏按钮在前，历史按钮放最右 —— 其下拉面板 right-0 才能对齐侧栏右缘，避免面板左侧溢出被裁剪。 */}
          <button
            aria-label={isFullscreen ? "返回看板" : "全屏对话"}
            className={cn(
              "flex h-8 items-center rounded-full border border-black/7 bg-white/70 font-medium text-black/62 transition hover:border-black/15 hover:text-black",
              isFullscreen ? "gap-1.5 px-3 text-[10px]" : "w-8 justify-center",
            )}
            onClick={handleToggleMode}
            type="button"
          >
            {isFullscreen ? <LayoutDashboardIcon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
            {isFullscreen ? "返回看板" : null}
          </button>
          <ChatHistoryPanel compact={!isFullscreen} />
        </div>
      </header>

      {errorMessage ? (
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs">
            <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <div><p className="font-medium">请求失败</p><p className="mt-0.5 text-[10px] text-muted-foreground">{errorMessage}</p></div>
          </div>
        </div>
      ) : null}

      {!hasConversation ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center px-6 pb-4">
          <span className="mb-5 grid size-10 place-items-center rounded-2xl bg-[#edf4de] text-[#51713b]"><Sparkles className="size-[18px]" /></span>
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-black/56">AI 助手</p>
          <h3 className="mt-2 max-w-[280px] text-[25px] font-medium leading-[1.08] tracking-[-0.05em]">你好，我是你的经营分析助手。<br />有什么可以帮你？</h3>
          <p className="mt-3 max-w-[290px] text-xs leading-relaxed text-black/62">你可以直接询问素材、投放与经营数据相关的问题。</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {mergedSuggestions.map((suggestion) => (
              <button
                className="rounded-full border border-black/8 bg-white/75 px-3 py-2 text-[10px] text-black/66 shadow-sm transition hover:-translate-y-0.5 hover:border-black/15 hover:text-black"
                disabled={isBusy}
                key={suggestion}
                onClick={() => {
                  void handleSubmit({ files: [], text: suggestion } satisfies PromptInputMessage);
                }}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="w-full gap-5 px-4 py-5">
            {localGreeting ? (
              <>
                <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-[#20241f] px-3.5 py-2.5 text-xs text-white">你好</div>
                <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-black/7 bg-white px-3.5 py-3 text-xs leading-relaxed text-black/70 shadow-sm">
                  你好！我是经营分析助手，有什么可以帮你？
                </div>
              </>
            ) : null}
            {agent.data.messages.map((message, index) => (
              <EveMessage
                canRespond={!isBusy}
                isStreaming={agent.status === "streaming" && index === agent.data.messages.length - 1}
                key={message.id}
                message={message}
                onInputResponses={(inputResponses) => agent.respond(inputResponses)}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div className="shrink-0 border-t border-black/7 bg-[#fbfaf6]/95 px-4 pb-4 pt-3 backdrop-blur-lg">
        {/* PromptInputProvider：把输入文本提升为受控状态，供 SkillSlashMenu 读写（斜杠补全）。 */}
        <PromptInputProvider>
          <div className="relative">
            <SkillSlashMenu skills={skills} />
            <PromptInput
              className="rounded-2xl border-black/9 bg-white shadow-[0_8px_28px_rgba(32,36,31,.07)]"
              onSubmit={handleSlashSubmit}
            >
              <PromptInputTextarea className="min-h-[54px] text-xs" placeholder="问问你的经营数据…（/ 可触发技能补全）" />
              <PromptInputSubmit onStop={requestCancellation} status={agent.status} />
            </PromptInput>
          </div>
        </PromptInputProvider>
        <p className="mt-2 text-center text-[9px] text-black/70">AI 助手可能出错，重要数据请以口径说明为准。</p>
      </div>
    </section>
  );
}

function StatusDot({ status }: { readonly status: AgentStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone = status === "error" ? "bg-destructive" : isLive ? "bg-[#7cad58]" : "bg-black/20";
  return (
    <span className="relative flex size-1.5" aria-label={status} role="status">
      {isLive ? <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-70", tone)} /> : null}
      <span className={cn("relative inline-flex size-1.5 rounded-full transition-colors", tone)} />
    </span>
  );
}
