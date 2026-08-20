import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { sendAndAnswer } from "./shared";

/**
 * 会话落库 + 多轮上下文连续（本轮 E2E 验证的核心回归点）。
 * 两层断言：
 *  1) 行为层：第二轮提问引用第一轮主题，回复必须体现上下文（会话连续性）；
 *  2) 数据层：直接读 web surface 的 SQLite（chat-sessions.db），断言包含
 *     本轮用户消息的会话存在 user + assistant 两行——assistant 消息必须随
 *     turn 结束同步落库（回归：assistant 未落库 → 刷新恢复为空页面）。
 *
 * 注意：eve eval 直接调用 agent HTTP 协议，不会经过浏览器里的 web history
 * adapter。仅当外层 Web E2E 通过 EVE_EVAL_CHAT_SESSIONS_DB 显式提供
 * SQLite 路径时才执行数据层断言；普通 Eve target 只验证多轮行为。
 */
export default defineEval({
	async test(t) {
		const marker = `会话验证${Date.now()}`;
		const FIRST = `${marker}：昨天素材消耗大概什么情况，说个大概就行`;
		const SECOND = "刚才那个消耗数字，帮我总结成一句放到周报里";

		await sendAndAnswer(t, FIRST);
		const second = await t.send(SECOND);
		if (second.inputRequests.length > 0) {
			for (const req of second.inputRequests) {
				await t.respond([{ text: "继续", requestId: req.requestId }]);
			}
		}

		t.succeeded();
		// 第二轮回复必须体现第一轮上下文（提到消耗/素材，而非当全新问题）
		t.check(
			t.reply,
			satisfies(
				(v: unknown) => /消耗|素材|成交/i.test(String(v)),
				"回复体现第一轮上下文",
			),
		);
		t.noFailedActions();

		// 数据层只由显式提供 Web history DB 的外层 E2E 启用；普通 eve eval
		// 不经过浏览器 history adapter，不能用仓库里可能残留的 SQLite 文件判定。
		const configuredDbPath = process.env.EVE_EVAL_CHAT_SESSIONS_DB?.trim();
		if (!configuredDbPath) {
			t.log("未配置 EVE_EVAL_CHAT_SESSIONS_DB，跳过 Web SQLite 断言");
			return;
		}
		const dbPath = path.resolve(process.cwd(), configuredDbPath);
		const dbExists = fs.existsSync(dbPath);
		t.check(
			dbExists,
			satisfies((v: unknown) => v === true, "配置的 Web SQLite 文件存在"),
		);
		if (!dbExists) return;
		const db = new DatabaseSync(dbPath, { readOnly: true });
		try {
			const row = db
				.prepare(
					"SELECT session_id FROM chat_messages WHERE content LIKE ? ORDER BY id DESC LIMIT 1",
				)
				.get(`%${marker}%`) as { session_id: string } | undefined;
			t.check(
				row?.session_id,
				satisfies(
					(v: unknown) => typeof v === "string",
					"SQLite 中存在包含本轮用户消息的会话",
				),
			);
			if (typeof row?.session_id !== "string") return;
			const roles = db
				.prepare(
					"SELECT role FROM chat_messages WHERE session_id = ? ORDER BY seq",
				)
				.all(row.session_id) as Array<{ role: string }>;
			const rolesList = roles.map((r) => r.role);
			t.check(
				rolesList,
				satisfies(
					(r: readonly string[]) =>
						r.includes("user") && r.includes("assistant"),
					"消息含 user + assistant 行（assistant 随 turn 结束落库）",
				),
			);
		} finally {
			db.close();
		}
	},
});
