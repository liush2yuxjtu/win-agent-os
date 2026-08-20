import { NextRequest, NextResponse } from "next/server";
import {
  appendChatMessages,
  clearChatSessions,
  deleteChatSession,
  listChatMessages,
  listChatSessions,
  upsertChatSession,
} from "@agent/lib/platform/web/chat-sessions/db";

/**
 * 聊天历史 API：
 *  - GET  /api/chat-sessions                       → 会话清单，默认 source=web（网页聊天）
 *  - GET  /api/chat-sessions?source=bot            → 仅 bot 会话清单（bot 聊天记录）
 *  - GET  /api/chat-sessions?source=all            → 全部来源
 *  - GET  /api/chat-sessions?sessionId=x           → 该会话的消息列表（bot 会话需传完整 bot 会话 ID）
 *  - POST /api/chat-sessions             → upsert 会话 + 幂等追加消息（seq 去重）
 *  - DELETE /api/chat-sessions?sessionId=x → 删除单个会话
 *  - DELETE /api/chat-sessions?all=1     → 清空全部
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (sessionId) {
    return NextResponse.json({ messages: listChatMessages(sessionId) });
  }
  const source = request.nextUrl.searchParams.get("source") ?? "web";
  return NextResponse.json({ sessions: listChatSessions(undefined, source) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      streamIndex?: number;
      title?: string;
      lastAt?: number;
      userMessages?: number;
      source?: string;
      messages?: Array<{ seq: number; role: string; content: string; toolName?: string }>;
    };
    if (!body.sessionId) {
      return NextResponse.json({ ok: false, error: "sessionId 必填" }, { status: 400 });
    }
    // 仅同步消息（无会话元数据）时只追加消息，避免把标题重置为「新对话」。
    const hasSessionMeta = body.title !== undefined || body.lastAt !== undefined || body.userMessages !== undefined;
    if (hasSessionMeta) {
      upsertChatSession(
        {
          sessionId: body.sessionId,
          streamIndex: body.streamIndex ?? 0,
          title: body.title ?? "新对话",
          lastAt: body.lastAt ?? Date.now(),
          userMessages: body.userMessages ?? 0,
        },
        body.source ?? "web",
      );
    }
    const inserted = appendChatMessages(body.sessionId, (body.messages ?? []).filter((m) => m && typeof m.role === "string"));
    return NextResponse.json({ ok: true, inserted });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "解析请求失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.searchParams.get("all") === "1") {
    clearChatSessions();
    return NextResponse.json({ ok: true });
  }
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "sessionId 必填（或 ?all=1）" }, { status: 400 });
  }
  deleteChatSession(sessionId);
  return NextResponse.json({ ok: true });
}
