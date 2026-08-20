---
description: "Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy. 中文触发：用户说「帮我提升/进化/优化 XX 技能」「让 XX 技能更好用」「这个技能触发不准/功能不达标，帮我改进」「对 XX 技能做评估并改进」时都应触发，即使没说 skill 名 —— 加载本技能后对指定技能走完整提升闭环（评估→评审→改进→重跑对比）。不要用于：单纯的数据问答、看板布局修改（走各自技能），或只要求看评估结果不改进（直接 run_skill_evals 即可）。"
---
# Skill Creator

A skill for creating new skills and iteratively improving them.

At a high level, the process of creating a skill goes like this:

- Decide what you want the skill to do and roughly how it should do it
- Write a draft of the skill
- Create a few test prompts and run claude-with-access-to-the-skill on them
- Help the user evaluate the results both qualitatively and quantitatively
  - While the runs happen in the background, draft some quantitative evals if there aren't any (if there are some, you can either use as is or modify if you feel something needs to change about them). Then explain them to the user (or if they already existed, explain the ones that already exist)
  - Use the `eval-viewer/generate_review.py` script to show the user the results for them to look at, and also let them look at the quantitative metrics
- Rewrite the skill based on feedback from the user's evaluation of the results (and also if there are any glaring flaws that become apparent from the quantitative benchmarks)
- Repeat until you're satisfied
- Expand the test set and try again at larger scale

Your job when using this skill is to figure out where the user is in this process and then jump in and help them progress through these stages. So for instance, maybe they're like "I want to make a skill for X". You can help narrow down what they mean, write a draft, write the test cases, figure out how they want to evaluate, run all the prompts, and repeat.

On the other hand, maybe they already have a draft of the skill. In this case you can go straight to the eval/iterate part of the loop.

Of course, you should always be flexible and if the user is like "I don't need to run a bunch of evaluations, just vibe with me", you can do that instead.

Then after the skill is done (but again, the order is flexible), you can also run the skill description improver, which we have a whole separate script for, to optimize the triggering of the skill.

Cool? Cool.

## Communicating with the user

The skill creator is liable to be used by people across a wide range of familiarity with coding jargon. If you haven't heard (and how could you, it's only very recently that it started), there's a trend now where the power of Claude is inspiring plumbers to open up their terminals, parents and grandparents to google "how to install npm". On the other hand, the bulk of users are probably fairly computer-literate.

So please pay attention to context cues to understand how to phrase your communication! In the default case, just to give you some idea:

- "evaluation" and "benchmark" are borderline, but OK
- for "JSON" and "assertion" you want to see serious cues from the user that they know what those things are before using them without explaining them

It's OK to briefly explain terms if you're in doubt, and feel free to clarify terms with a short definition if you're unsure if the user will get it.

---

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user may need to fill the gaps, and should confirm before proceeding to the next step.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't need them. Suggest the appropriate default based on the skill type, but let the user decide.

### Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until you've got this part ironed out.

Check available MCPs - if useful for research (searching docs, finding similar skills, looking up best practices), research in parallel via subagents if available, otherwise inline. Come prepared with context to reduce burden on the user.

### Write the SKILL.md

Based on the user interview, fill in these components:

- **name**: Skill identifier
- **description**: When to trigger, what it does. This is the primary triggering mechanism - include both what the skill does AND specific contexts for when to use it. All "when to use" info goes here, not in the body. Note: currently Claude has a tendency to "undertrigger" skills -- to not use them when they'd be useful. To combat this, please make the skill descriptions a little bit "pushy". So for instance, instead of "How to build a simple fast dashboard to display internal Anthropic data.", you might write "How to build a simple fast dashboard to display internal Anthropic data. Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, even if they don't explicitly ask for a 'dashboard.'"
- **compatibility**: Required tools, dependencies (optional, rarely needed)
- **the rest of the skill :)**

### Skill Writing Guide

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:
1. **Metadata** (name + description) - Always in context (~100 words)
2. **SKILL.md body** - In context whenever skill triggers (<500 lines ideal)
3. **Bundled resources** - As needed (unlimited, scripts can execute without loading)

These word counts are approximate and you can feel free to go longer if needed.

**Key patterns:**
- Keep SKILL.md under 500 lines; if you're approaching this limit, add an additional layer of hierarchy along with clear pointers about where the model using the skill should go next to follow up.
- Reference files clearly from SKILL.md with guidance on when to read them
- For large reference files (>300 lines), include a table of contents

**Domain organization**: When a skill supports multiple domains/frameworks, organize by variant:
```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
Claude reads only the relevant reference file.

#### Principle of Lack of Surprise

This goes without saying, but skills must not contain malware, exploit code, or any content that could compromise system security. A skill's contents should not surprise the user in their intent if described. Don't go along with requests to create misleading skills or skills designed to facilitate unauthorized access, data exfiltration, or other malicious activities. Things like a "roleplay as an XYZ" are OK though.

#### Writing Patterns

Prefer using the imperative form in instructions.

**Defining output formats** - You can do it like this:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern** - It's useful to include examples. You can format them like this (but if "Input" and "Output" are in the examples you might want to deviate a little):
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### Writing Style

Try to explain to the model why things are important in lieu of heavy-handed musty MUSTs. Use theory of mind and try to make the skill general and not super-narrow to specific examples. Start by writing a draft and then look at it with fresh eyes and improve it.

### Test Cases

After writing the skill draft, come up with 2-3 realistic test prompts — the kind of thing a real user would actually say. Share them with the user: [you don't have to use this exact language] "Here are a few test cases I'd like to try. Do these look right, or do you want to add more?" Then run them.

Save test cases to `evals/evals.json`. Don't write assertions yet — just the prompts. You'll draft assertions in the next step while the runs are in progress.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

See `references/schemas.md` for the full schema (including the `assertions` field, which you'll add later).

## Running and evaluating test cases

### 提升/进化快捷路径（用户说「提升/进化 XX 技能」时直接走这条）

用户意图是"把 XX 技能变得更好"时（不是从零创建），不要走完整访谈流程，直接执行：

1. **确认目标**：从用户话里提取技能名（"帮我提升 ai-control 技能" → ai-control；名字不确定时用技能清单确认）
2. **跑基线评估**：按下方「eve 环境适配」第 1 步执行——并行派发 eval-runner 子代理真实执行 functional 用例，再调 `run_skill_evals` 汇总（含无技能基线对比）
3. **展示并等待评审**：报告展开显示（Trigger/Functional + 基线对比行）→ **必须 ask_question 暂停等用户评审**（评审卡片逐例标注 + 备注）
4. **落盘反馈**：收到评审后先 `submit_skill_review` 写 feedback.json
5. **定向改进**：
   - 触发问题（漏触发/误触发）→ 调 `optimize_skill_description` 出 description 候选（内部多轮实测打分）→ 展示给用户 → 确认后写入 SKILL.md
   - 功能问题（verdict 不达标）→ 按评审意见改 SKILL.md 正文（只改相关点）
   - 用例缺口 → `add_eval_case` 补用例（或 `generate_negative_cases` 补负例，用户确认后应用）
6. **重跑对比**：按第 1 步重跑（新 iteration 目录），用 comparison + baseline 对比展示改进幅度（如 触发率 70%→90%、基线对比提升）
7. **收尾**：不达标且未到 3 轮 → 回到第 3 步；达标 → 总结改进前后指标，存盘即完成

### eve 环境适配（本仓库必须走这条路径）

**重要**：下方 Step 1-5 与 Description Optimization 的 Python 脚本流程是 Claude Code 专属（依赖 subagent spawn、`eval-viewer/generate_review.py`、`python -m scripts.aggregate_benchmark`、`claude -p` CLI —— **eve 沙箱里这些都不存在**）。eve agent 里跳过 Step 1-5，改走本仓库的原生工具闭环。**完整闭环（skill-creator 风格 loop）**——核心机制：Functional 用例由 **model 用内置 `agent` 工具（或声明的 `eval-runner` 子代理）并行派发子代理「真实执行」**（子代理加载 SKILL.md 作指令、用真实工具产出真实产物，不是模型模拟输出），再调 `run_skill_evals` 注入执行结果完成聚合与评判：

**第 0 步 · 循环起点（技能还不存在或要重写时）**
- 新建/重写技能：按上方「Creating a skill」方法论写好 SKILL.md 全文 → 调 `publish_skill` 发布到 `skill-packages/<name>/SKILL.md`（自动校验 frontmatter、生成 eve 动态 gate 并同步注册表）
- 写用例：按下方「Test Cases」节的格式，**调 `add_eval_case` 工具**按需新增用例（不要用 write_file 手写 JSON）：
  - functional 用例 → `evals/evals.json`（`{ skill_name, evals: [{ id, name, prompt, expected_output, expectations }] }`）
  - trigger 用例 → `evals/trigger-evals.json`（数组 `[{ query, should_trigger }]`，正例 true / 易混淆负例 false）
  - 评估暴露缺口时（触发漏判、负例缺失、功能期望不全）同样用 `add_eval_case` 补用例后再重跑
- **工作区约定（每个正式评估轮次必须遵守）**：产物放 `<repoRoot>/<skill-name>-workspace/`（仓库根，skill-packages 同级），按轮次组织：
  - `iteration-N/`（N 从 1 递增，一轮一目录）；每例一个 `eval-<描述性名字>/` 目录（按所测能力命名，不要用 eval-0），子目录 `with_skill/outputs/` 存子代理真实产物；新技能基线用 `without_skill/outputs/`，改进技能基线用 `old_skill/outputs/`
  - 每例写 `eval_metadata.json`：`{ "eval_id": <用例 id>, "eval_name": "<描述性名字>", "prompt": "<用例 prompt>", "assertions": [] }`（eval_id 与 add_eval_case 写入的用例 id 对应）
  - **timing 即时捕获**：每个子代理完成通知带 `total_tokens` / `duration_ms`，只存在于通知、不会自动持久化——收到即把它随 executionResults 传给汇总工具（附在该用例 evidence 尾部，如「耗时 23s / 84852 tokens」；若当前工具集提供文件写入能力则优先写 `eval-<名字>/timing.json`），不即时捕获即丢
  - **skill-snapshot 约定**：改进已有技能、需要在改进前后对比时，改 SKILL.md **之前**先 `cp -r <skill-path> <workspace>/skill-snapshot/`，基线子代理指向快照跑 `old_skill/outputs/`；快照必须在改动前做，否则基线被污染。新技能基线始终是 `without_skill`（无技能）

**第 1 步 · 跑评估（Trigger 工具判定 + Functional 子代理真实执行）**
1. **Functional——并行派发 eval-runner**：对每个 functional 用例发起一个子代理调用，**同一轮响应里全部发出**（不要先发一半等完成再发另一半；受子代理并发配额限制时按批派发，每批 4-6 个，批间等待完成再发下一批）。message 需自包含：技能路径 + 指示加载 SKILL.md 作指令 + 用例 prompt + 期望输出要点 + 输出目录（`<workspace>/iteration-N/eval-<名字>/with_skill/outputs/`）；并带 `outputSchema` 要求返回结构化结果 `{ caseId, verdict: "pass"|"partial"|"fail", evidence, output }`（caseId 用用例 prompt，evidence 给达成依据，output 给产物摘要）。基线子代理（`without_skill` 或 `old_skill`，见第 0 步）与 with_skill **同一轮并行派发**。**一轮评估内不要中途停下做别的事**，等全部子代理完成（每个完成通知即时捕获 timing，见第 0 步）。
2. **汇总**：子代理全部完成后调 `run_skill_evals(skillName, { executionResults: [...] })`——工具用注入的执行结果聚合 functional（逐例 evidence/output 摘录、passRate、HTML 报告、历史记录落盘），**跳过内部 llm 模拟判定**；**Trigger 评估**（正例命中 + 易混淆负例不误触发 + 无技能基线）由工具内部照旧执行。返回逐例数据 + 两份 HTML 报告 + 与上次运行的 comparison（指标 delta + 逐例翻转）。
3. **快速冒烟可不注入**：只想要快速反馈时可直接调 `run_skill_evals(skillName)`（不注入 executionResults，functional 走工具内部 llm 模拟路径）——但**正式评估 / 量化对比 / 上架前验证必须走子代理真实执行**。

**第 2 步 · 评审 HITL（人工标注）**
评估完成后 **必须调用 ask_question 暂停等用户评审**（建议 allowFreeform: true）：Trigger 例由专家逐例标注「应触发/不应触发」，Functional 例给「通过/部分达标/失败」评价并可加备注（评审卡片展示子代理真实产物的 output/evidence 摘录），然后点「提交评审」提交（评审卡片把意见经 inputResponses 回给 agent）。在收到评审意见前，不得解读/总结评估结果、不得自行改进技能。

**第 3 步 · 反馈落盘**
收到评审意见后，先调 `submit_skill_review` 把评审落盘到 `skill-packages/<name>/evals/feedback.json`（关键：不落盘不得解读结果或自行改进）。

**第 4 步 · 改进**
按反馈只改相关点：SKILL.md 的 description（触发问题 → `optimize_skill_description` 出候选、用户确认后应用）或正文（功能问题）、或调整 evals.json 用例。改完如技能是新版本，可用 `publish_skill` 重新上架。

**第 5 步 · 重跑对比**
新建 `iteration-<N+1>/` 目录，重复第 1 步（基线同前），再次调 `run_skill_evals` 注入新一批执行结果，用返回的 comparison 对比改进前后（通过率 delta、逐例翻转）。不达标回到第 2 步，达到迭代上限（默认 3 轮）或通过率达标即收尾。

**存盘即完成**：SKILL.md（publish_skill 已同步注册表）、evals.json、feedback.json 都在技能目录里持久化；`<skill>-workspace/iteration-N/` 的子代理产物目录也是持久化产物，下次续跑直接对比。

**权限/沙箱边界**：eval-runner 子代理只读技能目录、写入仅限 `<skill>-workspace/` 输出目录；**不得改 SKILL.md / evals.json**——对技能的一切改动只由主 model 经 `publish_skill` / `add_eval_case` / `submit_skill_review` 完成，否则并行派发时子代理会读到改了一半的 SKILL.md，评估失真。

**vibe 轻量路径**：用户说「不用细评 / 快速看看 / just vibe with me」时，不派发 eval-runner、不建 iteration 目录：直接读 SKILL.md 按指令自查，或只调 `run_skill_evals(skillName)` 快速冒烟。用户要正式评估 / 量化对比 / 上架前验证时才走完整闭环。

**扩规模引导**：达到通过率目标后，用 `add_eval_case` 批量补用例（每批补完重跑，避免一次大批量难以定位回归）；并行派发受子代理配额限制，按批派发；跨 iteration 复用评判口径与汇总逻辑（scripts 比目测可靠、可复用）；对比保留 mean±stddev 与 delta 形态。

下方 Step 1-5 为 Claude Code 环境的完整流程，eve 环境忽略，只遵循上方适配路径（workspace 组织 / skill-snapshot / timing 约定以上方为准）。

---

This section is one continuous sequence — don't stop partway through. Do NOT use `/skill-test` or any other testing skill.

Put results in `<skill-name>-workspace/` as a sibling to the skill directory. Within the workspace, organize results by iteration (`iteration-1/`, `iteration-2/`, etc.) and within that, each test case gets a directory (`eval-0/`, `eval-1/`, etc.). Don't create all of this upfront — just create directories as you go.

### Step 1: Spawn all runs (with-skill AND baseline) in the same turn

For each test case, spawn two subagents in the same turn — one with the skill, one without. This is important: don't spawn the with-skill runs first and then come back for baselines later. Launch everything at once so it all finishes around the same time.

**With-skill run:**

```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- Outputs to save: <what the user cares about — e.g., "the .docx file", "the final CSV">
```

**Baseline run** (same prompt, but the baseline depends on context):
- **Creating a new skill**: no skill at all. Same prompt, no skill path, save to `without_skill/outputs/`.
- **Improving an existing skill**: the old version. Before editing, snapshot the skill (`cp -r <skill-path> <workspace>/skill-snapshot/`), then point the baseline subagent at the snapshot. Save to `old_skill/outputs/`.

Write an `eval_metadata.json` for each test case (assertions can be empty for now). Give each eval a descriptive name based on what it's testing — not just "eval-0". Use this name for the directory too. If this iteration uses new or modified eval prompts, create these files for each new eval directory — don't assume they carry over from previous iterations.

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": []
}
```

### Step 2: While runs are in progress, draft assertions

Don't just wait for the runs to finish — you can use this time productively. Draft quantitative assertions for each test case and explain them to the user. If assertions already exist in `evals/evals.json`, review them and explain what they check.

Good assertions are objectively verifiable and have descriptive names — they should read clearly in the benchmark viewer so someone glancing at the results immediately understands what each one checks. Subjective skills (writing style, design quality) are better evaluated qualitatively — don't force assertions onto things that need human judgment.

Update the `eval_metadata.json` files and `evals/evals.json` with the assertions once drafted. Also explain to the user what they'll see in the viewer — both the qualitative outputs and the quantitative benchmark.

### Step 3: As runs complete, capture timing data

When each subagent task completes, you receive a notification containing `total_tokens` and `duration_ms`. Save this data immediately to `timing.json` in the run directory:

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

This is the only opportunity to capture this data — it comes through the task notification and isn't persisted elsewhere. Process each notification as it arrives rather than trying to batch them.

### Step 4: Grade, aggregate, and launch the viewer

Once all runs are done:

1. **Grade each run** — spawn a grader subagent (or grade inline) that reads `agents/grader.md` and evaluates each assertion against the outputs. Save results to `grading.json` in each run directory. The grading.json expectations array must use the fields `text`, `passed`, and `evidence` (not `name`/`met`/`details` or other variants) — the viewer depends on these exact field names. For assertions that can be checked programmatically, write and run a script rather than eyeballing it — scripts are faster, more reliable, and can be reused across iterations.

2. **Aggregate into benchmark** — run the aggregation script from the skill-creator directory:
   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```
   This produces `benchmark.json` and `benchmark.md` with pass_rate, time, and tokens for each configuration, with mean ± stddev and the delta. If generating benchmark.json manually, see `references/schemas.md` for the exact schema the viewer expects.
Put each with_skill version before its baseline counterpart.

3. **Do an analyst pass** — read the benchmark data and surface patterns the aggregate stats might hide. See `agents/analyzer.md` (the "Analyzing Benchmark Results" section) for what to look for — things like assertions that always pass regardless of skill (non-discriminating), high-variance evals (possibly flaky), and time/token tradeoffs.

4. **Launch the viewer** with both qualitative outputs and quantitative data:
   ```bash
   nohup python <skill-creator-path>/eval-viewer/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "my-skill" \
     --benchmark <workspace>/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```
   For iteration 2+, also pass `--previous-workspace <workspace>/iteration-<N-1>`.

   **Cowork / headless environments:** If `webbrowser.open()` is not available or the environment has no display, use `--static <output_path>` to write a standalone HTML file instead of starting a server. Feedback will be downloaded as a `feedback.json` file when the user clicks "Submit All Reviews". After download, copy `feedback.json` into the workspace directory for the next iteration to pick up.

Note: please use generate_review.py to create the viewer; there's no need to write custom HTML.

5. **Tell the user** something like: "I've opened the results in your browser. There are two tabs — 'Outputs' lets you click through each test case and leave feedback, 'Benchmark' shows the quantitative comparison. When you're done, come back here and let me know."

### What the user sees in the viewer

The "Outputs" tab shows one test case at a time:
- **Prompt**: the task that was given
- **Output**: the files the skill produced, rendered inline where possible
- **Previous Output** (iteration 2+): collapsed section showing last iteration's output
- **Formal Grades** (if grading was run): collapsed section showing assertion pass/fail
- **Feedback**: a textbox that auto-saves as they type
- **Previous Feedback** (iteration 2+): their comments from last time, shown below the textbox

The "Benchmark" tab shows the stats summary: pass rates, timing, and token usage for each configuration, with per-eval breakdowns and analyst observations.

Navigation is via prev/next buttons or arrow keys. When done, they click "Submit All Reviews" which saves all feedback to `feedback.json`.

### Step 5: Read the feedback

When the user tells you they're done, read `feedback.json`:

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "the chart is missing axis labels", "timestamp": "..."},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..."},
    {"run_id": "eval-2-with_skill", "feedback": "perfect, love this", "timestamp": "..."}
  ],
  "status": "complete"
}
```

Empty feedback means the user thought it was fine. Focus your improvements on the test cases where the user had specific complaints.

Kill the viewer server when you're done with it:

```bash
kill $VIEWER_PID 2>/dev/null
```

---

## Improving the skill

This is the heart of the loop. You've run the test cases, the user has reviewed the results, and now you need to make the skill better based on their feedback.

### How to think about improvements

1. **Generalize from the feedback.** The big picture thing that's happening here is that we're trying to create skills that can be used a million times (maybe literally, maybe even more who knows) across many different prompts. Here you and the user are iterating on only a few examples over and over again because it helps move faster. The user knows these examples in and out and it's quick for them to assess new outputs. But if the skill you and the user are codeveloping works only for those examples, it's useless. Rather than put in fiddly overfitty changes, or oppressively constrictive MUSTs, if there's some stubborn issue, you might try branching out and using different metaphors, or recommending different patterns of working. It's relatively cheap to try and maybe you'll land on something great.

2. **Keep the prompt lean.** Remove things that aren't pulling their weight. Make sure to read the transcripts, not just the final outputs — if it looks like the skill is making the model waste a bunch of time doing things that are unproductive, you can try getting rid of the parts of the skill that are making it do that and seeing what happens.

3. **Explain the why.** Try hard to explain the **why** behind everything you're asking the model to do. Today's LLMs are *smart*. They have good theory of mind and when given a good harness can go beyond rote instructions and really make things happen. Even if the feedback from the user is terse or frustrated, try to actually understand the task and why the user is writing what they wrote, and what they actually wrote, and then transmit this understanding into the instructions. If you find yourself writing ALWAYS or NEVER in all caps, or using super rigid structures, that's a yellow flag — if possible, reframe and explain the reasoning so that the model understands why the thing you're asking for is important. That's a more humane, powerful, and effective approach.

4. **Look for repeated work across test cases.** Read the transcripts from the test runs and notice if the subagents all independently wrote similar helper scripts or took the same multi-step approach to something. If all 3 test cases resulted in the subagent writing a `create_docx.py` or a `build_chart.py`, that's a strong signal the skill should bundle that script. Write it once, put it in `scripts/`, and tell the skill to use it. This saves every future invocation from reinventing the wheel.

This task is pretty important (we are trying to create billions a year in economic value here!) and your thinking time is not the blocker; take your time and really mull things over. I'd suggest writing a draft revision and then looking at it anew and making improvements. Really do your best to get into the head of the user and understand what they want and need.

### The iteration loop

After improving the skill:

1. Apply your improvements to the skill
2. Rerun all test cases into a new `iteration-<N+1>/` directory, including baseline runs. If you're creating a new skill, the baseline is always `without_skill` (no skill) — that stays the same across iterations. If you're improving an existing skill, use your judgment on what makes sense as the baseline: the original version the user came in with, or the previous iteration.
3. Launch the reviewer with `--previous-workspace` pointing at the previous iteration
4. Wait for the user to review and tell you they're done
5. Read the new feedback, improve again, repeat

Keep going until:
- The user says they're happy
- The feedback is all empty (everything looks good)
- You're not making meaningful progress

---

## run_skill_evals 评审流程（聊天内联评估）

本应用在聊天里内置了一套评估流程（`run_skill_evals` 工具 + 内联评审卡片），与上面
eval-viewer 的流程相互独立。在对话中评估/改进技能时走这条链路：

1. **运行评估** — Functional 用例先按上方「eve 环境适配」第 1 步并行派发
   eval-runner 子代理真实执行，再调 `run_skill_evals(skillName, { executionResults })`
   汇总（不注入时工具内部走 LLM 模拟路径，仅限快速冒烟）。返回 Trigger 命中率 +
   Functional 通过率 + 逐例数据（含子代理真实产物的 evidence/output 摘录），
   聊天内联渲染评审卡片。
2. **暂停等待用户评审（必做）** — 评估工具一返回，立即调用 `ask_question` 暂停
   （turn 持久化 park 在 `session.waiting`）。在用户评审之前，不得解读/总结评估
   结果、不得自行改进技能、不得进行其他动作。建议 prompt（按实际指标替换 X/Y）：

   ```
   评估已完成：Trigger 命中率 X%、Functional 通过率 Y%。请你在评审卡片上逐例标注——
   Trigger 例标「应触发/不应触发」（与判定不一致即为纠正），Functional 例给
   「通过/部分达标/失败」评价，均可加备注；标注完点卡片上的「提交评审」，或直接在
   对话中回复你的意见。
   ```

   用 `allowFreeform: true`，允许用户自由文本回复而不只点选项。
3. **用户提交** — 评审卡片把全部反馈汇总成一段结构化文本，经 `inputResponses`
   （keyed by `requestId`）回答挂起的询问；用户也可以直接在对话中回复意见。
   run 从暂停处精确恢复，你把收到的意见整理成结构化字段。
4. **落盘反馈（关键）** — 收到评审意见后，调用 `submit_skill_review(skillName,
   { triggerCorrections, functionalReviews })` 写入
   `skill-packages/<name>/evals/feedback.json`。key 格式与评审卡片一致：
   `trigger:`/`functional:` 前缀 + prompt/input 折叠空白后前 24 字符。这是
   「按反馈自动改进」与后续迭代读取反馈的入口，务必先落盘再动手改技能。
5. **按反馈改进** — 只做反馈要求的改动（改 SKILL.md 的指令/口径或 description
   路由），不重写无关内容。
6. **重跑评估验证** — 再次调用 `run_skill_evals`，与上次结果对比（工具返回
   comparison）。
7. **收尾** — 汇报改动点与新旧指标对比，问用户是否继续迭代。

---

## Advanced: Blind comparison

For situations where you want a more rigorous comparison between two versions of a skill (e.g., the user asks "is the new version actually better?"), there's a blind comparison system. Read `agents/comparator.md` and `agents/analyzer.md` for the details. The basic idea is: give two outputs to an independent agent without telling it which is which, and let it judge quality. Then analyze why the winner won.

This is optional, requires subagents, and most users won't need it. The human review loop is usually sufficient.

---

## Description Optimization

The description field in SKILL.md frontmatter is the primary mechanism that determines whether Claude invokes a skill. After creating or improving a skill, offer to optimize the description for better triggering accuracy.

### Step 1: Generate trigger eval queries

Create 20 eval queries — a mix of should-trigger and should-not-trigger. Save as JSON:

```json
[
  {"query": "the user prompt", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

The queries must be realistic and something a Claude Code or Claude.ai user would actually type. Not abstract requests, but requests that are concrete and specific and have a good amount of detail. For instance, file paths, personal context about the user's job or situation, column names and values, company names, URLs. A little bit of backstory. Some might be in lowercase or contain abbreviations or typos or casual speech. Use a mix of different lengths, and focus on edge cases rather than making them clear-cut (the user will get a chance to sign off on them).

Bad: `"Format this data"`, `"Extract text from PDF"`, `"Create a chart"`

Good: `"ok so my boss just sent me this xlsx file (its in my downloads, called something like 'Q4 sales final FINAL v2.xlsx') and she wants me to add a column that shows the profit margin as a percentage. The revenue is in column C and costs are in column D i think"`

For the **should-trigger** queries (8-10), think about coverage. You want different phrasings of the same intent — some formal, some casual. Include cases where the user doesn't explicitly name the skill or file type but clearly needs it. Throw in some uncommon use cases and cases where this skill competes with another but should win.

For the **should-not-trigger** queries (8-10), the most valuable ones are the near-misses — queries that share keywords or concepts with the skill but actually need something different. Think adjacent domains, ambiguous phrasing where a naive keyword match would trigger but shouldn't, and cases where the query touches on something the skill does but in a context where another tool is more appropriate.

The key thing to avoid: don't make should-not-trigger queries obviously irrelevant. "Write a fibonacci function" as a negative test for a PDF skill is too easy — it doesn't test anything. The negative cases should be genuinely tricky.

### Step 2: Review with user

Present the eval set to the user for review using the HTML template:

1. Read the template from `assets/eval_review.html`
2. Replace the placeholders:
   - `__EVAL_DATA_PLACEHOLDER__` → the JSON array of eval items (no quotes around it — it's a JS variable assignment)
   - `__SKILL_NAME_PLACEHOLDER__` → the skill's name
   - `__SKILL_DESCRIPTION_PLACEHOLDER__` → the skill's current description
3. Write to a temp file (e.g., `/tmp/eval_review_<skill-name>.html`) and open it: `open /tmp/eval_review_<skill-name>.html`
4. The user can edit queries, toggle should-trigger, add/remove entries, then click "Export Eval Set"
5. The file downloads to `~/Downloads/eval_set.json` — check the Downloads folder for the most recent version in case there are multiple (e.g., `eval_set (1).json`)

This step matters — bad eval queries lead to bad descriptions.

### Step 3: Run the optimization loop

Tell the user: "This will take some time — I'll run the optimization loop in the background and check on it periodically."

Save the eval set to the workspace, then run in the background:

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```

Use the model ID from your system prompt (the one powering the current session) so the triggering test matches what the user actually experiences.

While it runs, periodically tail the output to give the user updates on which iteration it's on and what the scores look like.

This handles the full optimization loop automatically. It splits the eval set into 60% train and 40% held-out test, evaluates the current description (running each query 3 times to get a reliable trigger rate), then calls Claude to propose improvements based on what failed. It re-evaluates each new description on both train and test, iterating up to 5 times. When it's done, it opens an HTML report in the browser showing the results per iteration and returns JSON with `best_description` — selected by test score rather than train score to avoid overfitting.

#### eve 环境适配（本仓库必须走这条路径）

**重要**：`scripts/run_loop.py` / `run_eval.py` / `improve_description.py` 依赖外部 `claude` CLI——**eve 环境没有 claude CLI，不要运行这些 Python 脚本**（先检查 `which claude`，无则直接走下方替代路径）。

替代路径（eve 原生工具，效果等价）：

1. **评估**：Functional 用例按上方「eve 环境适配」第 1 步并行派发 eval-runner 子代理真实执行，再调 `run_skill_evals(skillName, { executionResults })` 汇总（Trigger 由工具内部执行，返回逐例数据 + HTML 报告 + 与上次运行的对比）。
2. **触发描述优化**：调用 `optimize_skill_description(skillName, maxCandidates?, maxRounds?)` 工具——它以技能的 trigger 用例（evals/trigger-evals.json）为基准，内部多轮迭代（默认 3 轮、可配 1-5；每轮把上一轮最优作为基线继续生成候选）生成改进版 description 候选并逐个对全部用例实测打分，返回逐轮触发率证据（每轮基线→候选得分轨迹、失败用例清单）与最优候选（不自动写回 SKILL.md）。**注意：本工具只优化触发路由（trigger 基准），不覆盖功能评估——功能问题走 eve 适配闭环的 eval-runner 真实执行，两者互补**；若返回 `best: null`（所有候选均未超过基线），出口是补更难的 trigger 用例（`add_eval_case`）再跑，不要强行应用候选。
3. **应用候选（用户确认后）**：把工具返回的 `best.description` 展示给用户，用户确认（或说「应用」）后再更新 SKILL.md 的 description frontmatter；若用 `publish_skill` 重新上架会自动同步注册表。用户不确认不写回。
4. **验证**：重跑 `run_skill_evals`，对比历史（工具返回 comparison：指标 delta + 逐例翻转），直到通过率达标或达到迭代上限（默认 3 轮）。
5. **报告**：评估工具返回 HTML 报告；评审反馈在聊天内联卡片中完成（专家点选 + 备注，自动保存）。

### How skill triggering works

Understanding the triggering mechanism helps design better eval queries. Skills appear in Claude's `available_skills` list with their name + description, and Claude decides whether to consult a skill based on that description. The important thing to know is that Claude only consults skills for tasks it can't easily handle on its own — simple, one-step queries like "read this PDF" may not trigger a skill even if the description matches perfectly, because Claude can handle them directly with basic tools. Complex, multi-step, or specialized queries reliably trigger skills when the description matches.

This means your eval queries should be substantive enough that Claude would actually benefit from consulting a skill. Simple queries like "read file X" are poor test cases — they won't trigger skills regardless of description quality.

### Step 4: Apply the result

Take `best_description` from the JSON output and update the skill's SKILL.md frontmatter. Show the user before/after and report the scores.

---

### Package and Present (only if `present_files` tool is available)

Check whether you have access to the `present_files` tool. If you don't, skip this step. If you do, package the skill and present the .skill file to the user:

```bash
python -m scripts.package_skill <path/to/skill-folder>
```

After packaging, direct the user to the resulting `.skill` file path so they can install it.

---

## Claude.ai-specific instructions

In Claude.ai, the core workflow is the same (draft → test → review → improve → repeat), but because Claude.ai doesn't have subagents, some mechanics change. Here's what to adapt:

**Running test cases**: No subagents means no parallel execution. For each test case, read the skill's SKILL.md, then follow its instructions to accomplish the test prompt yourself. Do them one at a time. This is less rigorous than independent subagents (you wrote the skill and you're also running it, so you have full context), but it's a useful sanity check — and the human review step compensates. Skip the baseline runs — just use the skill to complete the task as requested.

**Reviewing results**: If you can't open a browser (e.g., Claude.ai's VM has no display, or you're on a remote server), skip the browser reviewer entirely. Instead, present results directly in the conversation. For each test case, show the prompt and the output. If the output is a file the user needs to see (like a .docx or .xlsx), save it to the filesystem and tell them where it is so they can download and inspect it. Ask for feedback inline: "How does this look? Anything you'd change?"

**Benchmarking**: Skip the quantitative benchmarking — it relies on baseline comparisons which aren't meaningful without subagents. Focus on qualitative feedback from the user.

**The iteration loop**: Same as before — improve the skill, rerun the test cases, ask for feedback — just without the browser reviewer in the middle. You can still organize results into iteration directories on the filesystem if you have one.

**Description optimization**: This section requires the `claude` CLI tool (specifically `claude -p`) which is only available in Claude Code. Skip it if you're on Claude.ai.

**Blind comparison**: Requires subagents. Skip it.

**Packaging**: The `package_skill.py` script works anywhere with Python and a filesystem. On Claude.ai, you can run it and the user can download the resulting `.skill` file.

**Updating an existing skill**: The user might be asking you to update an existing skill, not create a new one. In this case:
- **Preserve the original name.** Note the skill's directory name and `name` frontmatter field -- use them unchanged. E.g., if the installed skill is `research-helper`, output `research-helper.skill` (not `research-helper-v2`).
- **Copy to a writeable location before editing.** The installed skill path may be read-only. Copy to `/tmp/skill-name/`, edit there, and package from the copy.
- **If packaging manually, stage in `/tmp/` first**, then copy to the output directory -- direct writes may fail due to permissions.

---

## Cowork-Specific Instructions

If you're in Cowork, the main things to know are:

- You have subagents, so the main workflow (spawn test cases in parallel, run baselines, grade, etc.) all works. (However, if you run into severe problems with timeouts, it's OK to run the test prompts in series rather than parallel.)
- You don't have a browser or display, so when generating the eval viewer, use `--static <output_path>` to write a standalone HTML file instead of starting a server. Then proffer a link that the user can click to open the HTML in their browser.
- For whatever reason, the Cowork setup seems to disincline Claude from generating the eval viewer after running the tests, so just to reiterate: whether you're in Cowork or in Claude Code, after running tests, you should always generate the eval viewer for the human to look at examples before revising the skill yourself and trying to make corrections, using `generate_review.py` (not writing your own boutique html code). Sorry in advance but I'm gonna go all caps here: GENERATE THE EVAL VIEWER *BEFORE* evaluating inputs yourself. You want to get them in front of the human ASAP!
- Feedback works differently: since there's no running server, the viewer's "Submit All Reviews" button will download `feedback.json` as a file. You can then read it from there (you may have to request access first).
- Packaging works — `package_skill.py` just needs Python and a filesystem.
- Description optimization (`run_loop.py` / `run_eval.py`) should work in Cowork just fine since it uses `claude -p` via subprocess, not a browser, but please save it until you've fully finished making the skill and the user agrees it's in good shape.
- **Updating an existing skill**: The user might be asking you to update an existing skill, not create a new one. Follow the update guidance in the claude.ai section above.

---

## Reference files

The agents/ directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent.

- `agents/grader.md` — How to evaluate assertions against outputs
- `agents/comparator.md` — How to do blind A/B comparison between two outputs
- `agents/analyzer.md` — How to analyze why one version beat another

The references/ directory has additional documentation:
- `references/schemas.md` — JSON structures for evals.json, grading.json, etc.

---

Repeating one more time the core loop here for emphasis:

- Figure out what the skill is about
- Draft or edit the skill
- Run claude-with-access-to-the-skill on test prompts
- With the user, evaluate the outputs:
  - Create benchmark.json and run `eval-viewer/generate_review.py` to help the user review them
  - Run quantitative evals
- Repeat until you and the user are satisfied
- Package the final skill and return it to the user.

Please add steps to your TodoList, if you have such a thing, to make sure you don't forget. If you're in Cowork, please specifically put "Create evals JSON and run `eval-viewer/generate_review.py` so human can review test cases" in your TodoList to make sure it happens.

Good luck!
