import { defineTool } from "eve/tools";
import { Glossary, GlossaryError } from "../lib/glossary";
import extension from "../extension";

/**
 * 词典完整性校验：字段绑定存在、术语有聚合语义、加权比率引用有效、无重复绑定、规则引用有效。
 * 标注人员每次改完词典都应跑一次。
 */
export default defineTool({
  description:
    "校验当前挂载的术语词典与规则库：字段绑定的术语是否存在、每个术语是否声明了聚合语义（无聚合语义无法展开公式）、加权比率引用的分子分母是否可解析、字段是否重复绑定、规则引用的术语是否存在。返回问题清单，ok=true 表示全部通过。",
  inputSchema: {},
  async execute() {
    const { glossaryPath, rulesPath, dialect } = extension.config;
    const g = new Glossary(glossaryPath, rulesPath, dialect);
    try {
      return g.validate();
    } catch (e) {
      if (e instanceof GlossaryError) return { ok: false, error: e.message };
      throw e;
    }
  },
});
