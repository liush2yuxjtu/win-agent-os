/**
 * 平台级动态管控统一入口（defineDynamic gate）
 *
 * 本文件是 agent/skills/ 下唯一的动态技能解析器（统一入口），在原有
 * 「registry enabled 静态开关」之上叠加「渠道 × 用户」级平台可见性过滤：
 *
 *   最终技能集合 = registry enabled 的静态技能 ∩ 平台可见性(isSkillEnabled)过滤
 *
 * 即两层取交集：任何一层禁用即不可见。每轮 turn.started 重解析，
 * 配置变更后下一条消息立即生效（与旧 gate 的 runtime disable 语义一致）。
 *
 * 与旧机制的关系（叠加语义）：
 * - 旧机制：agent/skills/*.ts 每个技能一个 gate 文件（如 dongsheng-ordering.ts），
 *   逐技能调用 gatedSkill(name)，只有 registry enabled 一个维度，无 per-channel/user。
 * - 本文件取代这些逐技能 gate：枚举 lib/skills/registry.json 全部技能，
 *   静态侧复用 agent/lib/skills-runtime.ts 的 gatedSkill（registry enabled +
 *   包解析 + 缓存，读取函数不重复实现），动态侧用 agent/lib/platform/visibility.ts
 *   的 isSkillEnabled 按 (渠道, 用户) 过滤。
 * - 旧的逐技能 gate 文件（authoring-skills.ts / dongsheng-ordering.ts /
 *   skill-creator.ts）已被删除：eve 动态技能解析器按文件名 slug 去重，
 *   多个解析器输出同名技能会在 turn 解析时抛
 *   「Dynamic skill "x" collides with dynamic resolver」运行时错误，
 *   统一入口落地后旧文件必须移除（本次已移除）。
 * - 顺带修复旧机制的覆盖缺口：registry 中注册但没有 gate 文件的技能
 *   （ai-sdk / dongsheng-meal）此前永远不会暴露，统一入口按注册表全量枚举后
 *   只要 enabled 即可按可见性矩阵暴露。
 *
 * 工具侧不做动态过滤：工具可见性由技能可见性间接控制（技能中声明的工具随
 * 技能出现/消失），避免与 agent/tools/ 的静态注册（含 extension 静态工具注册）
 * 冲突 —— 动态解析器产出同名工具会与静态注册产生 override/冲突语义，
 * 故工具列表完全交给静态注册机制管理。
 *
 * isPluginEnabled（plugin_visibility 表）是插件级（qc/aro/dashboard/exa）的
 * 对应过滤，属 extension/插件层消费；技能与插件在数据模型上无关联
 * （registry 的 SkillRecord 无 plugin 字段，skill_visibility 独立于
 * plugin_visibility 播种），故本技能解析器只消费 isSkillEnabled。
 */
import { defineDynamic, type DynamicResolveContext, type SkillDefinition } from "eve/skills";
import { isSkillEnabled } from "../lib/platform/visibility";
import { readRegistryFile } from "../lib/skills/registry-file";
import { gatedSkill } from "../lib/skills-runtime";

/**
 * 渠道 id：取 eve 解析后的渠道 adapter kind（eve 0.38.3 recon 结论）：
 *   - 非 http 的 authored channel（wechat/wecom 等 chat-sdk 桥渠道）在
 *     runtime/resolve-channel.ts 被重写为 `channel:<文件路由名>`（channel:wechat /
 *     channel:wecom），是稳定且唯一的渠道标识；
 *   - 默认 HTTP 渠道（web）adapter kind 固定为 "http"，不被重写；
 *   - 无渠道上下文（内部轮询等）时退回 "http"（可见性矩阵的 web 档）。
 *
 * 注意：不读 ctx.channel.metadata.channelId —— chat-sdk 桥的 instrumentation
 * 投影（ChatSdkInstrumentationMetadata）中 channelId 是平台侧线程/会话 id
 * （thread.channelId，如微信群/联系人 id），不是渠道标识；若以它作渠道 id，
 * 每个会话会得到不同的「渠道 id」，渠道级可见性行（如 channel='channel:wechat'）
 * 将永远无法命中。
 */
function resolveChannelId(ctx: DynamicResolveContext): string {
  const kind = ctx.channel?.kind;
  if (typeof kind === "string" && kind.length > 0) return kind;
  return "http";
}

/**
 * 用户 id：取会话发起方认证上下文中最稳定标识用户的字段
 * （SessionAuthContext.principalId 必有、subject 可选），
 * 无认证信息（匿名/内部轮询）时退回 '*'（可见性矩阵的全局档）。
 */
function resolveUserId(ctx: DynamicResolveContext): string {
  const initiator = ctx.session.auth?.initiator;
  return initiator?.principalId ?? initiator?.subject ?? "*";
}

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const channelId = resolveChannelId(ctx);
      const userId = resolveUserId(ctx);

      // 全量枚举注册表技能：静态 enabled（gatedSkill 非空）∩ 平台可见性
      const visible: Record<string, SkillDefinition> = {};
      for (const skill of readRegistryFile().skills) {
        const def = gatedSkill(skill.name);
        if (!def) continue; // registry disabled 或包缺失 → 静态层不放行
        if (!isSkillEnabled(channelId, userId, skill.name)) continue; // 可见性矩阵不放行
        visible[skill.name] = def;
      }
      return visible;
    },
  },
});
