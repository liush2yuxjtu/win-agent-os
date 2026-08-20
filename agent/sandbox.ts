import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";
import { agentbayBackend } from "./lib/agentbay/backend";
import { resolveApiKey } from "./lib/agentbay/client";
import {
	decideQuotaEvictions,
	IDLE_MS,
	MAX_SANDBOXES_PER_USER,
} from "./lib/sandbox-reclaim";

/**
 * 沙箱后端：AgentBay（远程沙盒）优先；未配置 AGENTBAY_API_KEY 时回退
 * just-bash（本机直接执行，无 VM）——本地开发兜底。设置
 * EVE_SANDBOX_BACKEND=justbash 可强制使用 just-bash；本地 `eve eval`
 * 默认这样做，避免 AgentBay 账户级并发影响评估；just-bash 配额同步放宽到
 * Eve eval 默认并发 8，避免评估中的活跃会话互相 stop。
 *
 * AgentBay 是阿里云远程沙盒：内置 bash/文件工具全部在云端执行，本机零
 * 落盘。注意其 ephemeral 语义：stop() 即销毁（无可保留状态），会话重连后
 * 沙盒为新建；网络策略由阿里云侧管理。
 * 镜像：AGENTBAY_IMAGE_ID（默认 linux_latest）；区域：AGENTBAY_REGION_ID。
 *
 * just-bash 说明（无 AgentBay key 时）：演示/验收期使用；模拟 bash 无真实
 * 二进制（git/node 等不可用），真实二进制走 toolchain-mcp（:7332）。
 * microsandbox（本地轻量 VM）存在 100% CPU 自旋死锁 bug（msb 偶发，管理
 * 通道死锁），导致队列投递失败对话卡死，弃用。
 *
 * 自动回收机制（2026-08-20 重写，两种后端通用）：
 *  - 语义：「最近一次活动后 10 分钟无活动」才回收——agent 或用户任何
 *    活动（turn/step/工具调用/子代理等，见 hooks/sandbox-idle.ts 事件集）
 *    都会经 refresh 闭包重置计时器，而非对话开始后固定 10 分钟。
 *  - 按用户配额：每用户最多 MAX_SANDBOXES_PER_USER（默认 3）个沙盒；
 *    新会话 onSession 时若同用户已满，按 lastActivityAt 升序回收最久未
 *    活动的会话为新会话腾位（stop() 后 eve 在下次活动时自动重开沙盒，
 *    对话上下文在宿主侧，不受影响）。
 *  - 回收动作：stop()——AgentBay 销毁远程沙盒（避免持续计费）；just-bash
 *    仅释放计算（文件/上下文保留）。
 *  - 会话映射（threadId→sessionId）由 lib/bot-bindings 持久化，重启/回收后
 *    对话上下文照常恢复。
 */
interface SandboxIdleEntry {
	/** 会话归属用户（auth principalId ?? subject，匿名 "*"）。 */
	userId: string;
	/** 最近一次活动时间（Date.now()，配额回收排序依据）。 */
	lastActivityAt: number;
	/** 闲置回收计时器（到期 evict 本会话）。 */
	timer: ReturnType<typeof setTimeout>;
	/** 会话沙盒句柄获取（回收时 stop 用；onSession 闭包，跨回调可用）。 */
	getSandbox: () => Promise<{ stop: () => Promise<void> }>;
}

interface SandboxIdleRegistry {
	/** sessionId → entry（活动状态 + 回收所需）。 */
	entries: Map<string, SandboxIdleEntry>;
	/** sessionId → refresh 闭包（hooks/sandbox-idle.ts 活动续命调用）。 */
	refreshes: Map<string, () => void>;
}

const g = globalThis as unknown as { __sandboxIdle?: SandboxIdleRegistry };
g.__sandboxIdle ??= { entries: new Map(), refreshes: new Map() };

/** 用户 id：会话发起方认证上下文中最稳定标识（与 skills/visibility.ts 同口径）。 */
function resolveUserId(ctx: { session: { auth?: unknown } }): string {
	const auth = ctx.session.auth as
		| { initiator?: { principalId?: string; subject?: string } | null }
		| null
		| undefined;
	const initiator = auth?.initiator;
	return initiator?.principalId ?? initiator?.subject ?? "*";
}

/** 主动回收一个会话的沙盒（清计时器 + stop；不破坏宿主侧对话状态）。 */
async function evictSession(
	registry: SandboxIdleRegistry,
	sessionId: string,
	reason: string,
): Promise<void> {
	const entry = registry.entries.get(sessionId);
	if (!entry) return;
	clearTimeout(entry.timer);
	registry.entries.delete(sessionId);
	registry.refreshes.delete(sessionId);
	try {
		const sandbox = await entry.getSandbox();
		await sandbox.stop();
		console.log(`[sandbox] 回收会话 ${sessionId.slice(0, 12)}（${reason}）`);
	} catch (error) {
		// 回收失败不阻塞（沙箱可能已被 eve 重开）
		console.warn(
			"[sandbox] 回收失败:",
			error instanceof Error ? error.message : String(error),
		);
	}
}

// env 或 ~/.config/agentbay/api_key 任一存在即启用 AgentBay；eval 可显式强制 just-bash。
const forceJustBash =
	process.env.EVE_SANDBOX_BACKEND?.trim().toLowerCase() === "justbash";
const maxSandboxesPerUser = forceJustBash ? 8 : MAX_SANDBOXES_PER_USER;
const backend =
	forceJustBash || !resolveApiKey() ? justbash() : agentbayBackend();

export default defineSandbox({
	backend,
	async onSession({ use, ctx }) {
		await use();
		const sid = ctx.session.id;
		const userId = resolveUserId(ctx);
		const registry = g.__sandboxIdle!;

		// 按用户配额：同用户达到当前 backend 上限时，按最后活动时间
		// 升序回收最久未活动的会话（本会话尚未注册，腾出的名额给本会话）。
		const userSessions = [...registry.entries.entries()]
			.filter(([, entry]) => entry.userId === userId)
			.map(([sessionId, entry]) => ({
				sessionId,
				userId,
				lastActivityAt: entry.lastActivityAt,
			}));
		for (const victimSid of decideQuotaEvictions(
			userSessions,
			maxSandboxesPerUser,
		)) {
			void evictSession(
				registry,
				victimSid,
				`用户 ${userId} 配额（最多 ${maxSandboxesPerUser} 个沙盒）`,
			);
		}

		// 活动续命：重置 lastActivityAt + 重启 10 分钟计时器（hook 每活动调用）。
		const refresh = () => {
			const entry = registry.entries.get(sid);
			if (!entry) return;
			entry.lastActivityAt = Date.now();
			clearTimeout(entry.timer);
			entry.timer = setTimeout(
				() => void evictSession(registry, sid, `闲置 ${IDLE_MS / 60_000} 分钟`),
				IDLE_MS,
			);
		};

		registry.entries.set(sid, {
			userId,
			lastActivityAt: Date.now(),
			timer: setTimeout(refresh, IDLE_MS),
			getSandbox: () => ctx.getSandbox(),
		});
		registry.refreshes.set(sid, refresh);
	},
});
