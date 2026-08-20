"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, MessageSquare, QrCode, RefreshCw, ShieldCheck, Unplug, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  bindWecomBot,
  checkWechatScan,
  setBotBindingStatus,
  startWechatScan,
  unbindBot,
  updateBindingAllowedUsers,
} from "@/lib/bot-bindings/actions";
import type { BotBindingView } from "@agent/lib/platform/web/bot-bindings/types";

const PLATFORM_LABELS: Record<string, string> = { wechat: "微信", wecom: "企业微信" };

function formatShortTime(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

export function BotBindings({ initial }: { readonly initial: BotBindingView[] }) {
  const [bindings, setBindings] = useState(initial);
  const [name, setName] = useState("");
  const [botId, setBotId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 微信扫码状态
  const [scanName, setScanName] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<"idle" | "waiting" | "success" | "failed">("idle");
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 白名单编辑状态
  const [whitelistEditing, setWhitelistEditing] = useState<number | null>(null);
  const [whitelistDraft, setWhitelistDraft] = useState("");

  useEffect(() => () => {
    if (scanTimer.current) clearInterval(scanTimer.current);
  }, []);

  async function handleBindWecom() {
    setBusy(true);
    setNotice(null);
    const result = await bindWecomBot({ name, botId, secret });
    setBusy(false);
    if (!result.ok) {
      setNotice(`绑定失败：${result.error}`);
      return;
    }
    setNotice(result.hotBound ? "绑定成功，已立即生效。" : `已保存，但热绑定未启动（${result.hotError ?? "未知原因"}），需重启服务生效。`);
    setName("");
    setBotId("");
    setSecret("");
    window.location.reload();
  }

  async function handleStartScan() {
    setBusy(true);
    setNotice(null);
    const result = await startWechatScan({ name: scanName });
    setBusy(false);
    if (!result.ok) {
      setNotice(`扫码启动失败：${result.error}`);
      return;
    }
    setQrImage(result.qrcode); // iLink 返回登录链接，由 QRCodeSVG 渲染成二维码
    setScanStatus("waiting");
    scanTimer.current = setInterval(async () => {
      const check = await checkWechatScan(result.scanId);
      if (check.status === "success") {
        if (scanTimer.current) clearInterval(scanTimer.current);
        setScanStatus("success");
        setNotice("扫码成功，已绑定并立即生效。");
        setTimeout(() => window.location.reload(), 1500);
      } else if (check.status === "failed") {
        if (scanTimer.current) clearInterval(scanTimer.current);
        setScanStatus("failed");
        setNotice(check.error);
      }
    }, 3000);
  }

  async function handleToggle(binding: BotBindingView) {
    await setBotBindingStatus(binding.id, binding.status === "active" ? "disabled" : "active");
    window.location.reload();
  }

  async function handleUnbind(binding: BotBindingView) {
    await unbindBot(binding.id);
    window.location.reload();
  }

  function handleOpenWhitelist(binding: BotBindingView) {
    setWhitelistDraft((binding.allowedUsers ?? []).join("\n"));
    setWhitelistEditing(binding.id);
  }

  function handleCloseWhitelist() {
    setWhitelistEditing(null);
    setWhitelistDraft("");
  }

  async function handleSaveWhitelist(binding: BotBindingView) {
    const users = whitelistDraft
      .split(/[\n,，、]/)
      .map((u) => u.trim())
      .filter(Boolean);
    const result = await updateBindingAllowedUsers(binding.id, users);
    setWhitelistEditing(null);
    if (!result.ok) {
      setNotice(`白名单更新失败：${result.error}`);
      return;
    }
    setNotice(result.count > 0 ? `白名单已更新（${result.count} 个用户），立即生效。` : "白名单已清空，放开所有人对话。");
    window.location.reload();
  }

  return (
    <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] shadow-[0_12px_40px_rgba(35,38,31,.035)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/7 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.025em]">机器人接入</h2>
          <p className="mt-0.5 text-[10px] text-black/58">绑定微信或企业微信机器人后，可直接在聊天软件里使用分析助手</p>
        </div>
        <span className="rounded-full bg-[#edf3e4] px-2.5 py-1 text-[9px] font-semibold text-[#4f6b3d]">{bindings.length} 个绑定</span>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        {notice ? (
          <div className="flex items-start gap-2 rounded-xl border border-[#a27635]/25 bg-[#fdf6e9] px-3 py-2.5 text-[10px] text-[#7a5a2a]">
            <CircleAlert className="mt-0.5 size-3 shrink-0" />
            {notice}
          </div>
        ) : null}

        {/* 已绑定列表 */}
        {bindings.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-black/7">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-black/7 bg-black/[0.02] text-[9px] uppercase tracking-[0.08em] text-black/55">
                <tr>
                  <th className="px-4 py-2.5 font-medium">机器人</th>
                  <th className="px-4 py-2.5 font-medium">平台</th>
                  <th className="px-4 py-2.5 font-medium">连接</th>
                  <th className="px-4 py-2.5 font-medium">活跃</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/6">
                {bindings.map((binding) => (
                  <Fragment key={binding.id}>
                    <tr>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-7 place-items-center rounded-lg bg-[#ece9df] text-black/60">
                            <Bot className="size-3.5" />
                          </span>
                          <div>
                            <p className="font-medium">{binding.name}</p>
                            <p className="font-mono text-[9px] text-black/45">#{binding.id}{binding.owner ? ` · ${binding.owner}` : ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-black/62">{PLATFORM_LABELS[binding.platform] ?? binding.platform}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${binding.status === "active" ? "bg-[#e7f0db] text-[#466536]" : "bg-[#f1ecdf] text-[#7a6a42]"}`}>
                            {binding.status === "active" ? "运行中" : "已停用"}
                          </span>
                          {binding.allowedUsers && binding.allowedUsers.length > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#e8e6f7] px-2 py-0.5 text-[9px] font-semibold text-[#57508c]">
                              <ShieldCheck className="size-2.5" /> 白名单 {binding.allowedUsers.length}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                            binding.connectionStatus === "connected"
                              ? "bg-[#e0efe6] text-[#2f6b4a]"
                              : binding.connectionStatus === "failed"
                                ? "bg-[#f7e5dc] text-[#8b4a36]"
                                : "bg-[#f4ecd8] text-[#7a642f]"
                          }`}
                        >
                          <span className={`size-1 rounded-full ${binding.connectionStatus === "connected" ? "bg-[#4c8a63]" : "bg-[#a0863f]"}`} />
                          {binding.connectionStatus === "connected" ? "已连接" : binding.connectionStatus === "failed" ? "连接失败" : "等待连接"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-black/55">
                        {binding.lastActiveAt ? formatShortTime(binding.lastActiveAt) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            aria-label={`白名单 ${binding.name}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-black/8 bg-white/70 px-2 py-1 text-[9px] text-black/64 hover:border-black/15"
                            onClick={() => handleOpenWhitelist(binding)}
                            type="button"
                          >
                            <ShieldCheck className="size-2.5" /> 白名单
                          </button>
                          <button
                            aria-label={`${binding.status === "active" ? "停用" : "启用"} ${binding.name}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-black/8 bg-white/70 px-2 py-1 text-[9px] text-black/64 hover:border-black/15"
                            onClick={() => void handleToggle(binding)}
                            type="button"
                          >
                            <RefreshCw className="size-2.5" /> {binding.status === "active" ? "停用" : "启用"}
                          </button>
                          <button
                            aria-label={`解绑 ${binding.name}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#b66a4b]/20 bg-[#fff5ee] px-2 py-1 text-[9px] text-[#a75c3e] hover:border-[#b66a4b]/40"
                            onClick={() => void handleUnbind(binding)}
                            type="button"
                          >
                            <Unplug className="size-2.5" /> 解绑
                          </button>
                        </div>
                      </td>
                    </tr>
                    {whitelistEditing === binding.id ? (
                      <tr className="bg-[#faf8f1]">
                        <td className="px-4 py-3" colSpan={6}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-[240px] flex-1">
                              <div className="flex items-center gap-2">
                                <ShieldCheck className="size-3.5 text-[#57508c]" />
                                <p className="text-xs font-semibold">对话白名单</p>
                                <span className="rounded-full bg-[#e8e6f7] px-2 py-0.5 text-[9px] font-semibold text-[#57508c]">写入即生效</span>
                              </div>
                              <p className="mt-1 text-[9px] leading-relaxed text-black/55">
                                每行一个用户 ID（消息来源用户的唯一标识，逗号 / 顿号 / 换行分隔均可）。留空保存 = 清空白名单，放开所有用户。
                              </p>
                              <textarea
                                className="mt-2 h-24 w-full resize-y rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-[11px] outline-none focus:border-black/25"
                                onChange={(e) => setWhitelistDraft(e.target.value)}
                                placeholder={"未配置时所有用户可对话\n在此填入用户 ID 后仅允许这些人使用"}
                                value={whitelistDraft}
                              />
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                              <button
                                className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[10px] text-black/64 hover:border-black/25"
                                onClick={handleCloseWhitelist}
                                type="button"
                              >
                                <X className="size-3" /> 取消
                              </button>
                              <button
                                className="inline-flex items-center gap-1 rounded-lg bg-[#57508c] px-3 py-1.5 text-[10px] font-medium text-white transition hover:bg-[#4a4480]"
                                onClick={() => void handleSaveWhitelist(binding)}
                                type="button"
                              >
                                <ShieldCheck className="size-3" /> 保存白名单
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-black/10 bg-black/[0.015] px-4 py-6 text-center text-[10px] text-black/50">
            尚未绑定机器人。用下方表单添加企业微信机器人，或用微信扫码绑定。
          </p>
        )}

        {/* 企业微信绑定表单 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-black/7 bg-white/50 p-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-3.5 text-black/50" />
              <p className="text-xs font-semibold">企业微信 · 填 Bot ID + Secret</p>
            </div>
            <p className="mt-1 text-[9px] text-black/55">管理后台 → 应用管理 → 智能机器人，复制 Bot ID 与 Secret</p>
            <div className="mt-3 space-y-2">
              <input
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[11px] outline-none focus:border-black/25"
                onChange={(e) => setName(e.target.value)}
                placeholder="机器人名称（字母或中文开头，如：运营助手）"
                value={name}
              />
              <input
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-[11px] outline-none focus:border-black/25"
                onChange={(e) => setBotId(e.target.value)}
                placeholder="Bot ID"
                value={botId}
              />
              <input
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-[11px] outline-none focus:border-black/25"
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Secret"
                type="password"
                value={secret}
              />
              <button
                className="w-full rounded-lg bg-[#20241f] px-3 py-2 text-[11px] font-medium text-white transition hover:bg-black disabled:opacity-50"
                disabled={busy || !name || !botId || !secret}
                onClick={() => void handleBindWecom()}
                type="button"
              >
                保存绑定
              </button>
            </div>
          </div>

          {/* 微信扫码绑定 */}
          <div className="rounded-xl border border-black/7 bg-white/50 p-4">
            <div className="flex items-center gap-2">
              <QrCode className="size-3.5 text-black/50" />
              <p className="text-xs font-semibold">微信 · 扫码绑定</p>
            </div>
            <p className="mt-1 text-[9px] text-black/55">生成二维码后用微信扫描；扫码绑定的是 iLink bot 身份（形如 xxx@im.bot），请直接用微信给该 bot 发消息对话（1:1 私聊，不支持进普通微信群）</p>
            <div className="mt-3 space-y-2">
              {qrImage ? (
                <div className="flex flex-col items-center gap-2">
                  {qrImage.startsWith("data:") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="微信扫码登录二维码" className="size-36 rounded-lg border border-black/10" src={qrImage} />
                  ) : (
                    <div className="rounded-lg border border-black/10 bg-white p-2">
                      <QRCodeSVG size={128} value={qrImage} />
                    </div>
                  )}
                  <p className="text-[9px] text-black/55">
                    {scanStatus === "waiting" ? "请用微信扫描二维码（约 3 秒轮询一次）" : scanStatus === "success" ? "扫码成功 ✅" : "扫码失败"}
                  </p>
                </div>
              ) : (
                <>
                  <input
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[11px] outline-none focus:border-black/25"
                    onChange={(e) => setScanName(e.target.value)}
                    placeholder="机器人名称（字母或中文开头，如：我的助手）"
                    value={scanName}
                  />
                  <button
                    className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-[11px] font-medium text-black/75 transition hover:border-black/30 disabled:opacity-50"
                    disabled={busy || !scanName}
                    onClick={() => void handleStartScan()}
                    type="button"
                  >
                    生成扫码二维码
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-[9px] text-black/50">
          <CircleAlert className="size-2.5" />
          新绑定即时生效（无需重启）；解绑后需重启服务生效（本地开发：重启 npm run dev；生产：重新部署）。
        </p>
      </div>
    </section>
  );
}
