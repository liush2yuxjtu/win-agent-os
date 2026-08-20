import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { getEveAgentOrigin, isEveFrontendOnly } from "./lib/eve-frontend-config";

const nextConfig: NextConfig = {
  // lib/chat-sessions/db.ts 用 node:sqlite（内置模块），Turbopack 默认打包会
  // 报 "Failed to load external module node:sqlite: require is not defined"，
  // 声明为 server 外部模块让运行时直接 require。
  serverExternalPackages: ["node:sqlite"],
  // @chat-surface-ui/core / dsh-shared 源码（TS/TSX）作为 workspace 包由 Next.js 编译。
  transpilePackages: ["@chat-surface-ui/core", "dsh-shared"],
  // 开发模式允许 127.0.0.1 访问 dev 资源（Next 16 默认只白名单 localhost，
  // 自动化测试/脚本常用 127.0.0.1 访问，否则 script 请求带 Origin 被判跨域 → 403）。
  allowedDevOrigins: ["127.0.0.1"],
};

// 前端独立模式：EVE_FRONTEND_ONLY=1 时不包 withEve（Next.js 不拉起 agent），
// 改为把 /eve/v1/* rewrite 到单独运行的 agent。前端与 agent 均保持原样：
// 前端仍请求同源 /eve/v1/*，代理转发解决 CORS，agent 目录零改动。
const eveFrontendOnlyConfig: NextConfig = {
  ...nextConfig,
  async rewrites() {
    const eveOrigin = getEveAgentOrigin();
    return {
      beforeFiles: [
        {
          source: "/eve/v1/:path*",
          destination: `${eveOrigin}/eve/v1/:path*`,
        },
      ],
    };
  },
};

export default isEveFrontendOnly() ? eveFrontendOnlyConfig : withEve(nextConfig, { eveRoot: "../.." });
