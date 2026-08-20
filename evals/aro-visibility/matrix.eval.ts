import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import {
  isPluginEnabled,
  isSkillEnabled,
  resetVisibility,
  setPluginVisibility,
  setSkillVisibility,
} from "../../agent/lib/platform/visibility";

/**
 * per-channel × per-user 可见性矩阵语义(存储层,无需 server/backend)。
 *
 * 解析顺序：精确(channel+user) → 渠道级(channel,'*') → 全局('*','*'),
 * 最具体者胜出;无任何行时默认 true(fail-open)。
 * 单用户阶段 user_id='*';多用户时填具体用户 id 即隔离。
 */
export default defineEval({
  async test(t) {
    // 清空残留配置行,保证 ① 从干净状态开始(DB 是持久化的)
    resetVisibility();

    // ① 默认 fail-open：无配置行时全放行
    t.check(isPluginEnabled("wecom", "*", "aro"), equals(true));
    t.check(isSkillEnabled("web", "*", "st_01_demand_forecast"), equals(true));

    // ② 渠道级禁用：wecom 禁 aro 插件,web 不受影响
    setPluginVisibility("wecom", "*", "aro", false);
    t.check(isPluginEnabled("wecom", "*", "aro"), equals(false));
    t.check(isPluginEnabled("web", "*", "aro"), equals(true));

    // ③ 精确用户覆盖渠道级：wecom 下某用户单独放开
    setPluginVisibility("wecom", "user-a", "aro", true);
    t.check(isPluginEnabled("wecom", "user-a", "aro"), equals(true));
    t.check(isPluginEnabled("wecom", "user-b", "aro"), equals(false));

    // ④ 技能级：渠道级禁用单个技能
    setSkillVisibility("wecom", "*", "st_30_akbd_tracking", false);
    t.check(isSkillEnabled("wecom", "*", "st_30_akbd_tracking"), equals(false));
    t.check(isSkillEnabled("wecom", "*", "st_01_demand_forecast"), equals(true));

    t.succeeded();
  },
});
