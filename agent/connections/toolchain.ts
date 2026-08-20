import { defineMcpClientConnection } from "eve/connections";

const token = process.env.TOOLCHAIN_MCP_TOKEN;

/**
 * 受控二进制执行器：技能脚本（tsx）、git 只读、白名单 python。
 * 独立进程 bridge/toolchain-mcp（:7332），沙箱 just-bash 跑不了的真实二进制
 * 都经此连接受控执行。
 */
export default defineMcpClientConnection({
  url: process.env.TOOLCHAIN_MCP_URL ?? "http://127.0.0.1:7332/mcp",
  description:
    "受控二进制执行：运行技能包脚本（run_skill_script，tsx）、git 只读操作（git_op）、白名单目录 python3 脚本（python_script）。路径限定项目内、命令白名单、只读。",
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  tools: {
    allow: ["run_skill_script", "git_op", "python_script"],
  },
});
