/**
 * 技能描述（斜杠补全菜单用）。web 侧从 lib/skills/registry.json 传入；
 * standalone 侧可传空数组或自己的清单。
 */
export type SkillDescriptor = {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly metadata?: {
    readonly internal?: string | boolean;
  } | null;
};
