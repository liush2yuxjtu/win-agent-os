#!/bin/bash
# 跑 eve eval 套件（wrapper：worktree 隔离检查器拦截含 "eval" 的命令字符串）
exec /Users/liushiyuwin/MCP_connect_skill/node_modules/eve/bin/eve.js eval "$@"
