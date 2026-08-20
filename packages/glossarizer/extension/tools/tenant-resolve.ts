import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { Glossary, GlossaryError } from "../lib/glossary";
import extension from "../extension";

/**
 * 多租户术语解析：按调用者（session auth 的 tenant 属性）选词典。
 *
 * 同一引擎，不同租户看到不同的业务口径：
 *   - auth.attributes.tenant = "partner" → tenants.partner 的词典
 *   - 其他/未标注            → 顶层 glossaryPath/rulesPath（缺省词典）
 *
 * execute 必须是内联函数（replay 时从闭包重建），config 路径在 resolver 里闭包捕获。
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const tenant =
        (ctx.session.auth.current?.attributes as Record<string, unknown> | undefined)?.tenant ??
        "default";
      const { glossaryPath, rulesPath, dialect } = extension.config;
      const g = Glossary.forTenant(
        extension.config.tenants,
        { glossaryPath, rulesPath },
        String(tenant),
        dialect,
      );
      return {
        "tenant-resolve": defineTool({
          description: `按调用方租户（${tenant}）查询业务术语：返回定义、聚合语义、绑定字段溯源。字典: ${g.validate().glossaryPath}`,
          inputSchema: z.object({
            term: z.string().describe("业务术语名，如 ROI、产出、本周平均ROI"),
          }),
          execute: ({ term }) => {
            try {
              const r = g.resolve(term);
              return {
                tenant,
                term: r.name,
                definition: r.definition,
                aggregation: r.aggregation,
                grain: r.grain,
                sources: r.sources,
              };
            } catch (e) {
              if (e instanceof GlossaryError) return { tenant, error: e.message };
              throw e;
            }
          },
        }),
      };
    },
  },
});
