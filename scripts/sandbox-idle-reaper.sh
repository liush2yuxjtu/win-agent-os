#!/bin/bash
# microsandbox idle reaper —— 空闲 VM 自动销毁，给机器降温。
#
# eve 的 microsandbox 没有 idle 超时配置（VM 生命周期绑定 eve dev，不重启
# 就永久驻留，每个 VM 1vcpu+2GB）。eve 文档确认：sandbox VM 不可用时，
# eve 会用保留的模板按需自动重建 replacement——所以杀掉空闲 VM 是安全的。
#
# idle 判断：msb 进程的累计 CPU 时间（ps -o time）在 N 分钟内保持不变
# = VM 没在干活 → kill。注意：杀 VM 会丢沙箱 /workspace 里未持久化的文件
# （发布/写主 checkout 的文件不受影响）。
#
# 用法：
#   IDLE_MINUTES=10 nohup bash scripts/sandbox-idle-reaper.sh > /tmp/sbx-reaper.log 2>&1 &
# 或挂 launchd/cron（见文件末尾注释）。

IDLE_MINUTES="${IDLE_MINUTES:-10}"
STATE_DIR="${TMPDIR:-/tmp}/eve-sbx-idle"
mkdir -p "$STATE_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
log "sandbox idle reaper 启动：idle ${IDLE_MINUTES} 分钟销毁（每 60s 采样）"

while true; do
  for pid in $(pgrep -f "msb sandbox" 2>/dev/null); do
    t=$(ps -p "$pid" -o time= 2>/dev/null | tr -d ' ')
    [ -z "$t" ] && continue

    time_file="$STATE_DIR/$pid.time"
    idle_file="$STATE_DIR/$pid.idle"
    prev=$(cat "$time_file" 2>/dev/null)
    idle=$(cat "$idle_file" 2>/dev/null || echo 0)

    if [ "$t" = "$prev" ]; then
      idle=$((idle + 1))
    else
      idle=0
    fi

    if [ "$idle" -ge "$IDLE_MINUTES" ]; then
      log "销毁空闲 sandbox pid=$pid（CPU $t 连续 ${IDLE_MINUTES} 分钟无变化）"
      kill "$pid" 2>/dev/null
      rm -f "$time_file" "$idle_file"
      continue
    fi

    echo "$idle" > "$idle_file"
    echo "$t" > "$time_file"
  done
  sleep 60
done

# ── launchd 挂法（可选，替代 nohup）─────────────────────────────
# ~/Library/LaunchAgents/com.eve.sandbox-idle-reaper.plist:
#   <plist><dict>
#     <key>Label</key><string>com.eve.sandbox-idle-reaper</string>
#     <key>ProgramArguments</key>
#     <array><string>/bin/bash</string>
#           <string>/Users/liushiyuwin/MCP_connect_skill/scripts/sandbox-idle-reaper.sh</string></array>
#     <key>RunAtLoad</key><true/>
#     <key>KeepAlive</key><true/>
#     <key>EnvironmentVariables</key>
#     <dict><key>IDLE_MINUTES</key><string>10</string></dict>
#   </dict></plist>
#   launchctl load ~/Library/LaunchAgents/com.eve.sandbox-idle-reaper.plist
