#!/usr/bin/env python3
"""整页 spec 渲染验证：打开 http://localhost:3000，断言看板各区块均由 spec 渲染。

用法：/usr/bin/python3 scripts/verify-dashboard-page.py
退出码：0 = 全部通过；1 = 有断言失败（逐条输出 PASS/FAIL + 汇总）。
"""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

# 与基础款 spec 区块一一对应的文本断言（title 操作条由本组件渲染，其余来自 spec）
REQUIRED_TEXTS = [
    ("我的看板", "看板操作条（title，默认值）"),
    ("数据口径", "口径横幅（banner Alert）"),
    ("每日原始汇总走势", "走势图卡（chartCard Heading）"),
    ("高消耗素材明细", "素材明细表（topTable Card 标题）"),
    ("数据质量", "数据质量卡（qualityCard）"),
    ("数据来源与口径", "查询口径卡（queryCard）"),
]

# 核心经营指标 5 卡（KPI state 注入，标签来自业务公式层）
KPI_LABELS = ["近 7 日成交金额", "近 7 日广告消耗", "近 7 日支付 ROI", "近 7 日成交订单", "日均活跃素材"]


def fetch_top_material_name():
    """从 /api/query 拉取第一条真实素材名，用于断言明细表渲染真实数据而非占位。"""
    with urllib.request.urlopen(f"{BASE}/api/query?queryId=fixed:topMaterials", timeout=10) as resp:
        payload = json.loads(resp.read().decode())
    rows = payload.get("rows") or []
    return rows[0]["material_name"] if rows else None


def main():
    console_errors = []
    material_name = fetch_top_material_name()
    print(f"· 真实素材样本: {material_name}")

    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(f"pageerror: {err}"))

        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)

        def check(label, desc, fn):
            nonlocal failures
            try:
                fn()
                print(f"PASS  {label}（{desc}）")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL  {label}（{desc}）: {type(exc).__name__}: {exc}")

        for text, desc in REQUIRED_TEXTS:
            check(text, desc, lambda t=text: page.get_by_text(t, exact=False).first.wait_for(timeout=15000))

        for i, label in enumerate(KPI_LABELS, start=1):
            check(label, f"KPI 卡 {i}/5", lambda t=label: page.get_by_text(t, exact=False).first.wait_for(timeout=15000))

        if material_name:
            check(material_name, "明细表行含真实素材名", lambda: page.get_by_text(material_name).first.wait_for(timeout=15000))
        else:
            failures += 1
            print("FAIL  明细表行含真实素材名: /api/query 未返回素材数据")

        browser.close()

    print()
    if console_errors:
        failures += 1
        print(f"FAIL  console 无 error（发现 {len(console_errors)} 条）:")
        for err in console_errors[:10]:
            print(f"  - {err[:200]}")
    else:
        print("PASS  console 无 error")

    print()
    print(f"结果: {'全部通过' if failures == 0 else f'{failures} 项失败'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
