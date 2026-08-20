import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { resolveQuery } from "@/lib/qc-dashboard/registry";

/**
 * 查询数据接口：client 组件（ChatJsonRender / 看板）按 queryId 拉取最新数据。
 * dataRef 机制的服务端出口 —— spec 只携带 queryId 引用，数据在此解析。
 *
 * 缓存：15 分钟 revalidate（与 lib/qc-dashboard/data.ts 的 KPI 区同口径），
 * 避免看板每次刷新都打 QC。失败（QC 不可达/查询不存在）不缓存 ——
 * 内部包装抛错让 unstable_cache 跳过缓存，下次请求重试，防止缓存错误状态。
 * 注意：user:<slug> 的 SQL 被 qc_query_save 覆盖后，缓存最多 15 分钟后失效
 * （缓存键不含 SQL 文本；如需立即生效可后续加 revalidateTag 按 slug 失效）。
 */
const cachedResolve = unstable_cache(
  async (queryId: string) => {
    const data = await resolveQuery(queryId);
    if (!data) throw new Error(`query unavailable: ${queryId}`);
    return data;
  },
  ["qc-query-registry-v1"],
  { revalidate: 900 },
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const queryId = searchParams.get("queryId");
  if (!queryId) {
    return NextResponse.json({ error: "缺少 queryId 参数" }, { status: 400 });
  }
  try {
    const data = await cachedResolve(queryId);
    return NextResponse.json(data);
  } catch {
    // 查询不存在/失败/QC 不可达 → 200 null（渲染端降级为不注入，不炸界面；不缓存）
    return NextResponse.json(null);
  }
}
