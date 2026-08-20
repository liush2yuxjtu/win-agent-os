/**
 * eve profile CLI —— 统一的 profile 驱动 eve 启动入口。
 *
 * 让「挂载哪些 extension」成为 CLI 一等概念:先选 profile(组合),再跑 eve 命令。
 *
 * 用法(等价形态):
 *   npm run eve -- list                          # 列出所有 profile
 *   npm run eve -- use <name>                    # 切换组合(生成 agent/extensions/,不启动)
 *   npm run eve -- aro dev                       # profile 在前:aro 组合启动 eve dev
 *   npm run eve -- dev --extension-profile aro   # flag 形式:同上
 *   npm run eve -- aro build                     # aro 组合构建
 *   npm run eve -- aro start                     # aro 组合启动已构建产物
 *   npm run eve -- aro invoke <prompt>           # aro 组合 headless 调用
 *   npm run eve -- aro eval [evalIds...]         # aro 组合跑 evals
 *   npm run eve -- dev                           # 无 profile = full(默认,保持现状)
 *
 * 实现:解析 profile → 调用 scripts/sync-extensions.mts 生成组合 →
 * 以 EVE_EXTENSION_PROFILE=<name> 透传执行 eve <command>。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const SYNC_SCRIPT = path.join(ROOT, "scripts", "sync-extensions.mts");
const ENV_FILE = path.join(ROOT, "surfaces", "web", ".env.local");
const PROFILES_DIR = path.join(ROOT, "profiles");

function loadProjectEnv(): void {
	if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

function listProfileNames(): string[] {
	if (!fs.existsSync(PROFILES_DIR)) return [];
	const names: string[] = [];
	for (const file of fs.readdirSync(PROFILES_DIR)) {
		if (file.endsWith(".json")) names.push(file.slice(0, -5));
	}
	return names.sort((a, b) => a.localeCompare(b));
}

const PROFILES = listProfileNames();

function usage(): void {
	console.log(`eve profile CLI —— 先选组合,再跑 eve。

用法:
  npm run eve profile list                    列出所有 profile
  npm run eve profile use <name>              切换组合(生成 agent/extensions/,不启动)
  npm run eve profile current                 显示当前生效组合
  npm run eve <profile> <command> [args]      profile 在前:如 aro dev / aro build / aro start
  npm run eve <command> --extension-profile <name>
                                              flag 形式:如 dev --extension-profile aro
  npm run eve <command>                       command 形式:无 profile = full(默认)

commands: dev | build | start | invoke | eval
profiles: ${PROFILES.join(" | ")}
`);
}

function syncProfile(name: string): void {
	const r = spawnSync("npx", ["tsx", SYNC_SCRIPT, "--profile", name], {
		cwd: ROOT,
		stdio: "inherit",
		env: process.env,
	});
	if (r.status !== 0) process.exit(r.status ?? 1);
}

function main(): void {
	loadProjectEnv();
	const argv = process.argv.slice(2);
	if (argv.length === 0) {
		usage();
		return;
	}

	// ① profile 子命令组 / 元命令,不走 eve
	if (argv[0] === "profile") {
		const sub = argv[1];
		if (sub === "list") {
			spawnSync("npx", ["tsx", SYNC_SCRIPT, "--list"], {
				cwd: ROOT,
				stdio: "inherit",
			});
			return;
		}
		if (sub === "use") {
			const name = argv[2];
			if (!name) {
				console.error("用法: npm run eve profile use <profile>");
				process.exit(1);
			}
			syncProfile(name);
			return;
		}
		if (sub === "current") {
			const r = spawnSync("npx", ["tsx", SYNC_SCRIPT, "--list"], {
				cwd: ROOT,
				stdio: "pipe",
				encoding: "utf8",
			});
			const out = (r.stdout ?? "").split("\n");
			const cur = out.find((l) => l.includes("当前 agent/extensions/"));
			console.log(cur ?? "(无法读取当前组合)");
			return;
		}
		usage();
		process.exit(1);
	}

	const meta = argv[0];
	if (meta === "list") {
		spawnSync("npx", ["tsx", SYNC_SCRIPT, "--list"], {
			cwd: ROOT,
			stdio: "inherit",
		});
		return;
	}
	if (meta === "use") {
		const name = argv[1];
		if (!name) {
			console.error("用法: npm run eve use <profile>");
			process.exit(1);
		}
		syncProfile(name);
		return;
	}

	// ② 解析 profile:支持 "<profile> <command>" 与 "<command> --extension-profile <name>" 两种形态
	let profile: string | null = null;
	let command: string;
	let rest: string[];

	const first = argv[0];
	if (PROFILES.includes(first)) {
		// profile 在前:eve aro dev [args]
		profile = first;
		command = argv[1] ?? "";
		rest = argv.slice(2);
	} else {
		// command 在前:eve dev --extension-profile aro [args]
		command = first;
		const idx = argv.indexOf("--extension-profile");
		const inline = argv.find((arg) => arg.startsWith("--extension-profile="));
		if (idx !== -1 && argv[idx + 1]) {
			profile = argv[idx + 1];
			rest = [...argv.slice(1, idx), ...argv.slice(idx + 2)];
		} else if (inline) {
			profile = inline.slice("--extension-profile=".length);
			rest = argv.slice(1).filter((arg) => arg !== inline);
		} else {
			rest = argv.slice(1);
		}
	}

	if (
		!command ||
		!["dev", "build", "start", "invoke", "eval"].includes(command)
	) {
		usage();
		process.exit(command ? 2 : 0);
	}

	const profileName =
		profile ??
		process.env.EVE_EXTENSION_PROFILE?.trim().toLowerCase() ??
		"full";
	if (!PROFILES.includes(profileName)) {
		console.error(
			`❌ 未知 profile "${profileName}"。可用: ${PROFILES.join(", ")}`,
		);
		process.exit(1);
	}

	// ③ 生成组合 + 透传 eve 命令。本地 eval 默认用 just-bash，远程 target 不受影响。
	syncProfile(profileName);
	const env: NodeJS.ProcessEnv = { ...process.env, EVE_EXTENSION_PROFILE: profileName };
	const remoteEval = command === "eval" && rest.some((arg) => arg === "--url" || arg.startsWith("--url="));
	if (command === "eval" && !remoteEval) env.EVE_SANDBOX_BACKEND ??= "justbash";
	const r = spawnSync("eve", [command, ...rest], {
		cwd: ROOT,
		stdio: "inherit",
		env,
	});
	process.exit(r.status ?? 1);
}

main();
