/** 机器人绑定类型：业务专家现场绑定微信/企业微信 bot（非 env）。 */

export type BotPlatform = "wechat" | "wecom";

export type BotStatus = "active" | "pending" | "disabled";

export interface BotBinding {
  id: number;
  platform: BotPlatform;
  /** 展示名（机器人名称/专家名）。 */
  name: string;
  /** 归属专家（可选）。 */
  owner?: string;
  status: BotStatus;
  /** 企业微信：智能机器人 Bot ID。 */
  botId?: string;
  /** 企业微信：智能机器人 Secret。 */
  secret?: string;
  /** 微信：iLink 凭据存储目录（adapter dataDir，相对项目根）。 */
  accountDir?: string;
  /** 最近会话线程（定时主动推送用）。 */
  lastThreadId?: string;
  /** 实际连接状态（channel 启动/活跃时回写）。 */
  connectionStatus: BotConnectionStatus;
  /** 首次连接成功时间。 */
  connectedAt?: string;
  /** 最后活跃时间（收到消息时回写）。 */
  lastActiveAt?: string;
  /** 连接的机器人账号信息（JSON 摘要）。 */
  connectedInfo?: Record<string, unknown>;
  /** 允许对话的用户 ID 白名单（未配置/为空 = 放开所有人，QC 数据敏感时请配置）。 */
  allowedUsers?: string[];
  createdAt: string;
  updatedAt: string;
}

/** 实际连接状态：pending=已配置待连接；connected=已连接；failed=连接失败。 */
export type BotConnectionStatus = "pending" | "connected" | "failed";

/** 会话映射行：bot 会话 → eve sessionId（持久化于 SQLite）。 */
export interface BotSession {
  /** 会话 key：`${botKey}:${threadId}`，一个用户在不同 bot 各自独立会话。 */
  sessionKey: string;
  threadId: string;
  sessionId: string;
  /** bot 标识（wechat:bot_7 / wecom:bot_6 / wechat:env；legacy = 旧版迁移行）。 */
  botKey: string;
  /** 来源平台（wechat / wecom，可选）。 */
  platform?: BotPlatform;
  /** 关联的绑定 id（可选）。 */
  bindingId?: number;
  createdAt: string;
  updatedAt: string;
}

/** 绑定信息对外暴露（不含 secret——管理 UI 只显示掩码）。 */
export interface BotBindingView {
  id: number;
  platform: BotPlatform;
  name: string;
  owner?: string;
  status: BotStatus;
  /** 已配置凭据（true 表示 botId/secret 或 accountDir 存在）。 */
  configured: boolean;
  /** 实际连接状态（channel 启动/活跃时回写）。 */
  connectionStatus: BotConnectionStatus;
  /** 首次连接成功时间。 */
  connectedAt?: string;
  /** 最后活跃时间（收到消息时回写）。 */
  lastActiveAt?: string;
  /** 连接的机器人账号信息（JSON 摘要）。 */
  connectedInfo?: Record<string, unknown>;
  /** 允许对话的用户 ID 白名单（未配置/为空 = 放开所有人）。 */
  allowedUsers?: string[];
  createdAt: string;
  updatedAt: string;
}
