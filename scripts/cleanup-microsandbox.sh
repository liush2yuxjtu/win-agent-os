#!/bin/bash
# 每晚 20:00 清理 microsandbox 沙箱(crontab 触发,与 Claude/eve 进程无关):
#   - stop 所有 running 的 VM:优雅停止,保留磁盘与 durable session,会话恢复时自动重开
#   - remove 所有 stopped/crashed 的残留 VM:释放磁盘
# 会话历史存在 eve 侧(bot-bindings / session 文件),不受影响;仅沙箱工作区重置。
# 日志:~/microsandbox-cleanup.log

MSB=/Users/liushiyuwin/MCP_connect_skill/node_modules/microsandbox/bin/microsandbox.cjs
export PATH="/Users/liushiyuwin/.local/node/bin:$PATH"
LOG="$HOME/microsandbox-cleanup.log"

{
  echo "=== $(date '+%F %T') 清理开始 ==="

  # 1) 停止所有运行中的沙箱(优雅停止,给 30s 宽限)
  running=$($MSB list 2>/dev/null | awk '$3 == "running" {print $1}')
  if [ -n "$running" ]; then
    echo "-- 停止运行中的沙箱:"
    $MSB stop -t 30 $running
  else
    echo "-- 无运行中的沙箱"
  fi

  # 2) 逐个移除所有非运行中的残留(stopped/crashed),单个失败不中断
  #    (macOS bash 3.2 无 mapfile,用数组字面量 + IFS 分词)
  stale=($($MSB list 2>/dev/null | awk '$3 != "running" && $1 ~ /^eve-sbx/ {print $1}'))
  if [ ${#stale[@]} -gt 0 ]; then
    echo "-- 移除残留沙箱(${#stale[@]} 个):"
    for sb in "${stale[@]}"; do
      $MSB remove -f "$sb" || echo "!! 移除失败: $sb"
    done
  else
    echo "-- 无残留沙箱"
  fi

  echo "-- 清理后剩余:"
  $MSB list 2>/dev/null || true
  echo "=== $(date '+%F %T') 清理完成 ==="
} >> "$LOG" 2>&1
