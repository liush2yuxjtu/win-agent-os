/**
 * Extension 组合生成脚本（profile 驱动）。
 *
 * 概念：eve 的 extension 挂载是静态目录扫描（agent/extensions/*.ts 全挂，
 * 无条件挂载能力）。本脚本把「挂载哪些 extension」提升为 profile 配置：
 *
 *   agent/extensions-available/<plugin>.ts   全量可用挂载文件（真实文件，commit）
 *   profiles/<name>.json                     组合声明（{ extensions: [...] }）
 *   agent/extensions/                        生成目录（eve 扫描，本脚本维护，不 commit）
 *
 * 用法：
 *   npm run extensions:sync -- --profile aro    # 按 profile 组合生成 agent/extensions/
 *   npm run extensions:sync                     # 默认 full（全量，保持现有行为）
 *   npm run extensions:sync -- --list           # 列出可用 profile 与当前生效组合
 *   EVE_EXTENSION_PROFILE=aro npm run dev       # dev 脚本集成（见 package.json）
 *
 * 语义：选中的 available 文件复制进 agent/extensions/，未选中的删除。
 * 无 EVE_EXTENSION_PROFILE / 无 --profile 时 = full（全量 4 个），与旧行为一致。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const AVAILABLE_DIR = path.join(ROOT, "agent", "extensions-available");
const EXTENSIONS_DIR = path.join(ROOT, "agent", "extensions");
const PROFILES_DIR = path.join(ROOT, "profiles");

const args = process.argv.slice(2);
// 支持 --profile=aro 与 --profile aro 两种形态
let profileArg: string | undefined;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--profile") {
		profileArg = args[i + 1];
		break;
	}
	if (args[i].startsWith("--profile=")) {
		profileArg = args[i].split("=")[1];
		break;
	}
}
const profileName =
	profileArg ??
	process.env.EVE_EXTENSION_PROFILE?.trim().toLowerCase() ??
	"full";
const listOnly = args.includes("--list");

interface Profile {
	name: string;
	description?: string;
	extensions: string[];
}

function loadProfiles(): Map<string, Profile> {
	const map = new Map<string, Profile>();
	if (!fs.existsSync(PROFILES_DIR)) return map;
	for (const file of fs
		.readdirSync(PROFILES_DIR)
		.filter((f) => f.endsWith(".json"))) {
		try {
			const p = JSON.parse(
				fs.readFileSync(path.join(PROFILES_DIR, file), "utf8"),
			) as Profile;
			map.set(p.name, p);
		} catch {
			console.error(`⚠️  跳过无法解析的 profile: ${file}`);
		}
	}
	return map;
}

function listAvailable(): string[] {
	if (!fs.existsSync(AVAILABLE_DIR)) return [];
	return fs
		.readdirSync(AVAILABLE_DIR)
		.filter((f) => f.endsWith(".ts"))
		.map((f) => f.replace(/\.ts$/, ""));
}

function currentExtensions(): string[] {
	if (!fs.existsSync(EXTENSIONS_DIR)) return [];
	return fs
		.readdirSync(EXTENSIONS_DIR)
		.filter((f) => f.endsWith(".ts"))
		.map((f) => f.replace(/\.ts$/, ""));
}

function syncProfile(profile: Profile): void {
	const available = listAvailable();
	const requested = profile.extensions;
	const missing = requested.filter((name) => !available.includes(name));
	if (missing.length > 0) {
		console.error(
			`❌ profile "${profile.name}" 引用了不存在的 extension: ${missing.join(", ")}`,
		);
		process.exit(1);
	}

	fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

	// 1. 删除不在 profile 里的现有生成文件
	const stale = currentExtensions().filter((name) => !requested.includes(name));
	for (const name of stale) {
		fs.unlinkSync(path.join(EXTENSIONS_DIR, `${name}.ts`));
	}

	// 2. 复制选中的 available 文件（内容原样 = 标准挂载文件，eve 静态识别）
	for (const name of requested) {
		const src = path.join(AVAILABLE_DIR, `${name}.ts`);
		const dst = path.join(EXTENSIONS_DIR, `${name}.ts`);
		fs.copyFileSync(src, dst);
	}

	const removed = stale.length > 0 ? `，移除 ${stale.join(", ")}` : "";
	console.log(
		`✓ profile "${profile.name}" → agent/extensions/: [${requested.join(", ")}]${removed}`,
	);
}

function main(): void {
	const profiles = loadProfiles();

	if (listOnly) {
		const current = currentExtensions();
		console.log("可用 profile:");
		for (const p of profiles.values()) {
			const marker = p.name === profileName ? " *" : "";
			console.log(
				`  ${p.name}${marker}: [${p.extensions.join(", ")}]${p.description ? ` — ${p.description}` : ""}`,
			);
		}
		console.log(`\n当前 agent/extensions/: [${current.join(", ")}]`);
		console.log(`请求的 profile: ${profileName}`);
		return;
	}

	const profile = profiles.get(profileName);
	if (!profile) {
		console.error(
			`❌ 未知 profile "${profileName}"。可用: ${[...profiles.keys()].join(", ")}`,
		);
		process.exit(1);
	}
	syncProfile(profile);
}

main();
