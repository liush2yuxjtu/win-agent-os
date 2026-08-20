import fs from "node:fs";
import { listBindings, upsertBinding } from "../agent/lib/platform/web/bot-bindings/db";

// 迁移：数字开头的绑定名改为 bot- 前缀（含 accountDir 目录移动）
for (const b of listBindings()) {
  if (/^[0-9]/.test(b.name)) {
    const newName = "bot-" + b.name;
    const oldDir = b.accountDir;
    const newDir = oldDir?.replace(/\.wechat-[^/]+$/, ".wechat-" + newName);
    if (oldDir && newDir && oldDir !== newDir && fs.existsSync(oldDir)) {
      fs.renameSync(oldDir, newDir);
    }
    upsertBinding({
      id: b.id, platform: b.platform, name: newName, owner: b.owner,
      status: b.status, botId: b.botId, secret: b.secret, accountDir: newDir,
    });
    console.log(`迁移: ${b.name} → ${newName}${oldDir && newDir ? "（目录已移动）" : ""}`);
  }
}
console.log("完成");
