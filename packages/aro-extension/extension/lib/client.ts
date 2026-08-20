/** aro backend 工具执行客户端:POST /api/tools/execute */
export interface AroExtensionConfig {
  baseUrl: string;
  token?: string;
}

export interface AroApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

export async function callTool(
  config: AroExtensionConfig,
  tool: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/tools/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify({ tool, params }),
  });
  const json = (await res.json()) as AroApiResponse;
  if (!res.ok || json.success === false) {
    throw new Error(json.message ?? `aro tool ${tool} failed (HTTP ${res.status})`);
  }
  return json.data;
}

export async function listTools(config: AroExtensionConfig): Promise<string[]> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/tools/list`);
  const json = (await res.json()) as AroApiResponse<string[]>;
  if (!res.ok || json.success === false) {
    throw new Error(json.message ?? "aro tools list failed");
  }
  return json.data ?? [];
}
