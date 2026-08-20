/**
 * AgentBay 远程沙盒的 eve SandboxBackend 实现（design-protocol: agentBayDemo）。
 *
 * 让 eve 的沙盒机制（内置 bash/read_file/write_file/glob/grep 工具、
 * ctx.getSandbox()、bootstrap/onSession 生命周期）整体运行在阿里云
 * AgentBay 远程沙盒上，而不是本机。接入点：agent/sandbox.ts 的 backend。
 *
 * 能力映射（AgentBay SDK → eve SandboxSession）：
 * - run()            → session.command.executeCommand（输出按 exitCode 归入 stdout/stderr）
 * - readTextFile()   → session.fileSystem.readFile（startLine/endLine 按行切片）
 * - writeTextFile()  → session.fileSystem.writeFile
 * - read/writeBinary → 文本通道尽力而为（AgentBay 文件通道是 UTF-8 文本）
 * - removePath()     → rm 命令模拟
 * - spawn()          → 不支持（AgentBay 无长驻进程句柄），明确报错
 * - setNetworkPolicy → 不支持（网络由阿里云侧管理），明确报错
 *
 * 语义限制（与官方 vercel/docker backend 的差异，评估时注意）：
 * - AgentBay 沙盒是 ephemeral：stop()/shutdown() 只能销毁，无法保留状态重开；
 *   会话 reconnect 后沙盒为新建（/workspace 内容丢失）。
 * - prewarm 无模板机制：每次 create 均为全新沙盒，seedFiles 每次写入。
 *
 * 未来路线（方案 C，需人工审批后实施）：
 * - VPC 会话打通内网：AgentBay SDK 支持 isVpc / betaNetworkId 创建 VPC 会话，
 *   GetSessionData 返回 vpcIp / vpcId / httpPort / token。当内部服务（QC
 *   bridge / toolchain / 数据库）迁移到阿里云 VPC 后，沙盒可直连内部服务。
 * - 风险：沙盒直连内网 = 内网攻击面。实施前必须人工审批，且需评估网络
 *   隔离、鉴权与审计策略。当前架构（方案 A 数据桥接）保持沙盒不触内网。
 */
import type {
  SandboxBackend,
  SandboxBackendCreateInput,
  SandboxBackendHandle,
  SandboxBackendPrewarmInput,
  SandboxSeedFile,
  SandboxSession,
} from "eve/sandbox";
import type { Session as AgentBaySession } from "wuying-agentbay-sdk";
import { dirname } from "node:path";
import { createSandbox, destroySandbox } from "./client";

const DEFAULT_TIMEOUT_MS = 120_000;

/** prewarm 时登记的 seed 文件（AgentBay 无模板，create 时写入新沙盒）。 */
const seedRegistry = new Map<string, ReadonlyArray<SandboxSeedFile>>();
/** 会话级复用表：同一 sessionKey 复用同一远程沙盒。
 *
 * 背景：AgentBay API key 有并发上限（默认 10），而 eve 单 turn 内会多次
 * open sandbox（bash/文件工具各开一次）。不复用会瞬间打满并发导致 400。
 * 复用的沙盒由 idle 回收（agent/sandbox.ts 的 stop()）或 AgentBay 自身
 * idleReleaseTimeout（默认 10 分钟）销毁释放。 */
const liveSessions = new Map<string, AgentBaySession>();

class AgentBaySandboxSession implements SandboxSession {
  readonly id: string;
  readonly description = "AgentBay 远程沙盒（阿里云，根目录 /，镜像见 AGENTBAY_IMAGE_ID）";

  constructor(private readonly session: AgentBaySession) {
    this.id = session.sessionId ?? "agentbay";
  }

  resolvePath(path: string): string {
    return path.startsWith("/") ? path : `/${path}`;
  }

  /** AgentBay fileSystem.writeFile 不自动创建父目录（实测 errno 2）；
   *  写前用命令 mkdir -p 保证目录存在，同目录只确保一次。 */
  private readonly ensuredDirs = new Set<string>();
  private async ensureDir(dir: string) {
    if (!dir || dir === "/" || this.ensuredDirs.has(dir)) return;
    await this.session.command.executeCommand(`mkdir -p ${dir}`);
    this.ensuredDirs.add(dir);
  }

  async run(options: { command: string; workingDirectory?: string; env?: Record<string, string> }) {
    const result = await this.session.command.executeCommand(
      options.command,
      DEFAULT_TIMEOUT_MS,
      options.workingDirectory,
      options.env,
    );
    const exitCode = result.exitCode ?? (result.success ? 0 : 1);
    const output = result.output ?? "";
    // AgentBay 返回合并输出，无法区分 stdout/stderr：按退出码归边
    return exitCode === 0 ? { exitCode, stdout: output, stderr: "" } : { exitCode, stdout: "", stderr: output };
  }

  spawn(): never {
    throw new Error("AgentBay 沙盒不支持长驻进程（无进程句柄 API）；请改用 run()");
  }

  async readTextFile(options: { path: string; encoding?: string; startLine?: number; endLine?: number }) {
    const result = await this.session.fileSystem.readFile(this.resolvePath(options.path));
    if (!result.success) return null;
    const lines = (result.content ?? "").split("\n");
    const start = options.startLine ?? 1;
    const end = options.endLine ?? lines.length;
    const slice = lines.slice(Math.max(0, start - 1), Math.min(lines.length, end));
    return slice.join("\n");
  }

  async readBinaryFile(options: { path: string }) {
    const text = await this.readTextFile({ path: options.path });
    return text === null ? null : new TextEncoder().encode(text);
  }

  async readFile(options: { path: string }): Promise<ReadableStream<Uint8Array> | null> {
    const bytes = await this.readBinaryFile(options);
    if (bytes === null) return null;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async writeTextFile(options: { path: string; content: string }) {
    const fullPath = this.resolvePath(options.path);
    await this.ensureDir(dirname(fullPath));
    const result = await this.session.fileSystem.writeFile(fullPath, options.content);
    if (!result.success) {
      throw new Error(`AgentBay 写文件失败（${options.path}）：${result.errorMessage ?? "未知错误"}`);
    }
  }

  async writeBinaryFile(options: { path: string; content: Uint8Array }) {
    await this.writeTextFile({ path: options.path, content: new TextDecoder().decode(options.content) });
  }

  async writeFile(options: { path: string; content: ReadableStream<Uint8Array> }) {
    const reader = options.content.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    await this.writeBinaryFile({ path: options.path, content: bytes });
  }

  async removePath(options: { path: string; recursive?: boolean; force?: boolean }) {
    const r = options.recursive ? " -r" : "";
    const f = options.force === false ? "" : "f";
    const result = await this.session.command.executeCommand(`rm ${r} -${f} ${this.resolvePath(options.path)}`);
    if (result.exitCode && result.exitCode !== 0) {
      throw new Error(`AgentBay 删除失败（${options.path}）：${result.output ?? "未知错误"}`);
    }
  }

  setNetworkPolicy(): never {
    throw new Error("AgentBay 沙盒网络策略由阿里云侧管理，eve 防火墙策略无法应用");
  }
}

/** 组装 eve SandboxBackend。镜像可用 AGENTBAY_IMAGE_ID 覆盖（默认 linux_latest）。 */
export function agentbayBackend(): SandboxBackend {
  const imageId = process.env.AGENTBAY_IMAGE_ID?.trim() || "linux_latest";

  return {
    name: "agentbay",

    async prewarm(input: SandboxBackendPrewarmInput) {
      // AgentBay 无模板捕获机制：只登记 seed 文件，create 时写入。
      if (input.seedFiles.length > 0) {
        seedRegistry.set(input.templateKey, input.seedFiles);
      }
      input.log?.(`AgentBay 无模板预热：seed 文件 ${input.seedFiles.length} 个将在每次建沙盒时写入`);
      return { reused: false };
    },

    async create(input: SandboxBackendCreateInput): Promise<SandboxBackendHandle> {
      const existing = liveSessions.get(input.sessionKey);
      if (existing) {
        const reused = new AgentBaySandboxSession(existing);
        return {
          session: reused,
          useSessionFn: async () => reused,
          captureState: async () => ({
            backendName: "agentbay",
            sessionKey: input.sessionKey,
            metadata: { sessionId: reused.id },
          }),
          stop: async () => {
            await destroySandbox(existing);
            liveSessions.delete(input.sessionKey);
          },
          shutdown: async () => {
            await destroySandbox(existing);
            liveSessions.delete(input.sessionKey);
          },
        };
      }
      const session = await createSandbox({ imageId, labels: { eve: "1", session: input.sessionKey.slice(0, 12) } });
      liveSessions.set(input.sessionKey, session);
      const sandboxSession = new AgentBaySandboxSession(session);
      // 写入 prewarm 登记的 seed 文件
      for (const file of seedRegistry.get(input.templateKey ?? "") ?? []) {
        await sandboxSession.writeTextFile({ path: file.path, content: String(file.content) });
      }
      return {
        session: sandboxSession,
        useSessionFn: async () => sandboxSession,
        captureState: async () => ({
          backendName: "agentbay",
          sessionKey: input.sessionKey,
          metadata: { sessionId: sandboxSession.id },
        }),
        stop: async () => {
          await destroySandbox(session);
          liveSessions.delete(input.sessionKey);
        },
        shutdown: async () => {
          await destroySandbox(session);
          liveSessions.delete(input.sessionKey);
        },
      };
    },
  };
}
