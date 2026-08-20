/**
 * AgentBay 远程沙盒 provider 封装（design-protocol: agentBayDemo）。
 *
 * 协议来源：agentBayDemo（agentbay-ink-demo）—— 沙盒创建/执行/销毁 +
 * TTL 生命周期 + 凭据脱敏 + 禁止本地 fallback。本文件把该协议收敛为
 * eve agent 可用的最小封装：
 *
 * - createSandbox()：AgentBay SDK 建沙盒（imageId / lifecyclePolicy / labels）
 * - runCommand()：沙盒内执行命令（timeout、cwd、envs）
 * - writeFileToSandbox()：把脚本/文件写入沙盒（复杂代码先落盘再执行）
 * - destroySandbox()：销毁沙盒（必须调用，避免持续计费）
 * - safeMessage()：错误脱敏（不泄漏 API key / sessionId / requestId）
 *
 * 凭据解析优先级：环境变量 AGENTBAY_API_KEY → ~/.config/agentbay/api_key。
 * region：AGENTBAY_REGION_ID（cn-hangzhou / ap-southeast-1 / us-east-1）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentBay, LifecyclePolicy, setupLogger, type Session as AgentBaySession } from "wuying-agentbay-sdk";

// 关掉 SDK INFO 日志：resourceUrl/authcode/requestId 会泄漏到 stdout，
// 污染 eve 工具输出并被模型读取（design-protocol: agentBayDemo 的脱敏要求）
setupLogger({ level: "ERROR", enableConsole: false });

const DEFAULT_IDLE_MINUTES = 10;
const DEFAULT_MAX_MINUTES = 120;
const MAX_OUTPUT = 12_000;

/** 从环境变量或 ~/.config/agentbay/api_key 读取凭据。 */
export function resolveApiKey(): string {
  const fromEnv = process.env.AGENTBAY_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const filePath = join(homedir(), ".config", "agentbay", "api_key");
    const fromFile = readFileSync(filePath, "utf-8").trim();
    if (fromFile) return fromFile;
  } catch {
    // 文件不存在或不可读时忽略，走下面的明确报错
  }
  return "";
}

/** 创建 AgentBay 客户端（region 优先，endpoint 兜底）。 */
export function createAgentBayClient() {
  const apiKey = resolveApiKey();
  const regionId = process.env.AGENTBAY_REGION_ID?.trim();
  const config = regionId ? { region_id: regionId } : {};
  return new AgentBay({ apiKey, config });
}

export interface CreateSandboxOptions {
  imageId?: string;
  idleMinutes?: number;
  maxMinutes?: number;
  labels?: Record<string, string>;
}

/** 创建远程沙盒（默认 linux_latest，生命周期遵循 agentBayDemo 协议）。 */
export async function createSandbox(options: CreateSandboxOptions = {}) {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error(
      "缺少 AGENTBAY_API_KEY：请设置环境变量，或运行 agentBayDemo 的 `npm run agentbay:login` 写入 ~/.config/agentbay/api_key",
    );
  }
  const client = createAgentBayClient();
  const idleMinutes = options.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  const maxMinutes = options.maxMinutes ?? DEFAULT_MAX_MINUTES;
  const result = await client.create({
    imageId: options.imageId ?? "linux_latest",
    labels: { app: "dsh-platform", provider: "agentbay", ...options.labels },
    lifecyclePolicy: new LifecyclePolicy({ idleReleaseTimeout: idleMinutes, maxRuntime: maxMinutes }),
  });
  if (!result.success || !result.session) {
    throw new Error(`AgentBay 沙盒创建失败：${safeMessage(result.errorMessage || "未知错误")}`);
  }
  return result.session;
}

export interface RunCommandOptions {
  timeoutMs?: number;
  cwd?: string;
  envs?: Record<string, string>;
}

/** 沙盒内执行一条命令（run/exec 同义，均返回 { success, output, exitCode }）。 */
export async function runCommand(session: AgentBaySession, command: string, options: RunCommandOptions = {}) {
  const result = await session.command.executeCommand(command, options.timeoutMs, options.cwd, options.envs);
  if (!result.success) {
    throw new Error(`沙盒命令执行失败：${safeMessage(result.errorMessage || "未知错误")}`);
  }
  return {
    output: clipOutput(result.output ?? ""),
    exitCode: result.exitCode ?? 0,
  };
}

/** 把内容写入沙盒文件（复杂脚本先落盘再执行，避免命令行转义问题）。 */
export async function writeFileToSandbox(session: AgentBaySession, path: string, content: string) {
  const result = await session.fileSystem.writeFile(path, content);
  if (!result.success) {
    throw new Error(`沙盒写文件失败（${path}）：${safeMessage(result.errorMessage || "未知错误")}`);
  }
}

/** 销毁沙盒（协议要求：执行后必须销毁，避免持续计费）。 */
export async function destroySandbox(session: AgentBaySession): Promise<void> {
  try {
    await session.delete();
  } catch (error) {
    throw new Error(`AgentBay 沙盒销毁失败：${safeMessage(String(error))}`);
  }
}

/** 输出截断（协议：12KB 上限，超出标注省略）。 */
function clipOutput(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n…（输出已截断，超出 ${MAX_OUTPUT} 字符）`;
}

/** 错误脱敏：不泄漏 API key / sessionId / requestId / tenantId（协议要求）。 */
export function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\b(?:sk|akm?)-[A-Za-z0-9_-]{8,}\b/gu, "<redacted>")
    .replace(/\b(?:s-[a-z0-9]+|link-\d+-\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/giu, "<redacted-id>")
    .replace(/\btenantId\s*[:=]\s*[A-Za-z0-9-]+/giu, "tenantId: <redacted>")
    .replace(/(api[_ -]?key|token|secret)\s*[:=]\s*\S+/giu, "$1=<redacted>");
}
