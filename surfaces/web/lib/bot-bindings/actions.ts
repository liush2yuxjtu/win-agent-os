"use server";

import path from "node:path";
import { revalidateTag } from "next/cache";
import { createWeChatAcpAdapter } from "chat-adapter-wechat";
import {
  deleteBinding,
  setAllowedUsers,
  setBindingStatus,
  updateConnection,
  upsertBinding,
} from "@agent/lib/platform/web/bot-bindings/db";
import { startHotBot } from "./hot-runtime";
import type { BotBinding } from "@agent/lib/platform/web/bot-bindings/types";

// 名称必须以字母或中文开头：eve 用 adapter key 生成路由正则的命名捕获组，
// 数字开头（如 "123"）会产出 /^wechat(?<123>...)$/ 非法命名组导致 server 崩溃
const NAME_PATTERN = /^[A-Za-z一-鿿][\w一-鿿-]{0,31}$/;

/**
 * 企业微信绑定（填 Bot ID + Secret）。
 * 写库后立即热绑定（startHotBot 在 server 进程内动态创建 Chat 实例），
 * 无需重启服务即可生效。
 */
export async function bindWecomBot(input: {
  name: string;
  botId: string;
  secret: string;
  owner?: string;
}): Promise<{ ok: true; id: number; hotBound?: boolean; hotError?: string } | { ok: false; error: string }> {
  const name = input.name.trim();
  const botId = input.botId.trim();
  const secret = input.secret.trim();
  if (!NAME_PATTERN.test(name)) return { ok: false, error: "名称仅允许中文、字母、数字与连字符，1-32 字符" };
  if (!botId || !secret) return { ok: false, error: "Bot ID 与 Secret 必填" };

  const binding = upsertBinding({ platform: "wecom", name, botId, secret, owner: input.owner?.trim() || undefined });
  revalidateTag("bot-bindings", "minutes");
  // 热绑定：立即生效（同一 botKey 已被冷启动 channel 接管时静默跳过，重启后自然生效）
  const hot = await startHotBot(binding);
  if (!hot.ok) {
    console.warn(`[bindWecomBot] 绑定已保存，但热绑定未启动（${hot.reason}）`);
    return { ok: true, id: binding.id, hotBound: false, hotError: hot.reason };
  }
  updateConnection(binding.id, {
    status: "connected",
    connectedInfo: { platform: "wecom", botId: binding.botId, note: "热绑定即时生效" },
  });
  console.log(`[bindWecomBot] 企业微信 bot ${name}（id=${binding.id}）绑定成功并已立即生效`);
  return { ok: true, id: binding.id, hotBound: true };
}

/**
 * 更新绑定白名单（[] = 清空放开所有人）。
 * relay 收到消息时实时检查 isUserAllowed，写入后立即生效，无需重启。
 */
export async function updateBindingAllowedUsers(
  id: number,
  users: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const cleaned = [...new Set(users.map((u) => u.trim()).filter(Boolean))];
  if (cleaned.some((u) => u.length > 128)) return { ok: false, error: "用户 ID 长度不能超过 128 字符" };
  if (cleaned.length > 200) return { ok: false, error: "白名单用户数不能超过 200 个" };
  setAllowedUsers(id, cleaned);
  revalidateTag("bot-bindings", "minutes");
  return { ok: true, count: cleaned.length };
}

/** 启停绑定。 */
export async function setBotBindingStatus(id: number, status: "active" | "disabled"): Promise<{ ok: true } | { ok: false; error: string }> {
  setBindingStatus(id, status);
  revalidateTag("bot-bindings", "minutes");
  return { ok: true };
}

/** 解绑（删除绑定记录）。 */
export async function unbindBot(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  deleteBinding(id);
  revalidateTag("bot-bindings", "minutes");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 微信扫码绑定（无头 QR 登录：server 生成 QR → 前端展示 → 扫码 → 凭据入库）
// ---------------------------------------------------------------------------

interface PendingScan {
  adapter: ReturnType<typeof createWeChatAcpAdapter>;
  result: Promise<unknown>;
  startedAt: number;
}

const pendingScans = new Map<string, PendingScan>();

function accountDirFor(name: string): string {
  return path.join(process.cwd(), "lib/bot-bindings", `.wechat-${name}`);
}

/**
 * 发起微信扫码。
 * 注意：iLink 返回的 qrcode 是登录链接（https://liteapp.weixin.qq.com/q/...），
 * 不是图片 base64——前端需用二维码组件把链接渲染成 QR 码。
 */
export async function startWechatScan(input: { name: string; owner?: string }): Promise<
  { ok: true; scanId: string; qrcode: string } | { ok: false; error: string }
> {
  const name = input.name.trim();
  if (!NAME_PATTERN.test(name)) return { ok: false, error: "名称仅允许中文、字母、数字与连字符，1-32 字符" };

  const existing = pendingScans.get(name);
  if (existing && Date.now() - existing.startedAt < 120_000) {
    return { ok: false, error: "已有进行中的扫码，请先完成或等待 2 分钟超时" };
  }

  const adapter = createWeChatAcpAdapter({
    botId: name,
    dataDir: accountDirFor(name),
  });
  try {
    const session = await adapter.startQrLogin();
    const pending: PendingScan = {
      adapter,
      result: session.result,
      startedAt: Date.now(),
    };
    pendingScans.set(name, pending);
    // 结果落定后写入绑定表（accountDir 路径）+ 热绑定（立即生效）+ 连接状态回写（含 bot 身份）
    void session.result
      .then(async (account: { botId?: string }) => {
        const binding = upsertBinding({ platform: "wechat", name, accountDir: accountDirFor(name), owner: input.owner?.trim() || undefined });
        // 热绑定：扫码完成即启动独立 Chat 实例，无需重启（同一 botKey 已被冷启动接管时跳过）
        const hot = await startHotBot(binding);
        if (!hot.ok) {
          console.warn(`[startWechatScan] 绑定已保存，但热绑定未启动（${hot.reason}）`);
        } else {
          console.log(`[startWechatScan] 微信 bot ${name}（id=${binding.id}）扫码绑定成功并已立即生效`);
        }
        updateConnection(binding.id, {
          status: "connected",
          connectedInfo: {
            platform: "wechat",
            botId: account.botId,
            note: "扫码完成，凭据已落盘",
          },
        });
        revalidateTag("bot-bindings", "minutes");
      })
      .catch(() => {
        /* 扫码失败/取消：不写绑定 */
      })
      .finally(() => pendingScans.delete(name));
    return { ok: true, scanId: name, qrcode: session.qrcode.imageBase64 };
  } catch (error) {
    return { ok: false, error: `扫码启动失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 轮询扫码状态（前端每 3 秒调一次）。 */
export async function checkWechatScan(scanId: string): Promise<
  { status: "pending" } | { status: "success" } | { status: "failed"; error: string }
> {
  const pending = pendingScans.get(scanId);
  if (!pending) {
    // 已完成（已写入绑定表）或超时清理
    const bindings = (await import("@agent/lib/platform/web/bot-bindings/db")).listBindings("wechat");
    if (bindings.some((b: BotBinding) => b.name === scanId)) return { status: "success" };
    return { status: "failed", error: "扫码已过期，请重新发起" };
  }
  try {
    await Promise.race([pending.result, new Promise((resolve) => setTimeout(resolve, 0))]);
    // result 尚未落定
    const settled = await Promise.race([
      pending.result.then(() => "done" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 1500)),
    ]);
    if (settled === "done") return { status: "success" };
    return { status: "pending" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}
