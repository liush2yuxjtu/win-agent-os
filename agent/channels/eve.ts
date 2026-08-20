/**
 * 渠道 metadata 投影说明（eve 0.38.3 recon 结论）：
 *
 * eveChannel 的输入类型（EveChannelInput）不包含 `metadata` / `state` 选项：
 * 默认 HTTP 渠道无平台状态，内部 defineChannel 也未挂 metadata 投影，因此
 * 无法投影 { channelId: 'web' }，dynamic resolver 读到的 ctx.channel.metadata 恒为空。
 *
 * 替代方案（供 dynamic resolver 兜底）：eve HTTP channel 的 adapter kind 固定
 * 为 "http"（runtime/resolve-channel.ts 只重写非 http 的 authored channel，
 * 本渠道不被重写），用 ctx.channel.kind === "http" 识别 web 渠道。
 */
import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
});
