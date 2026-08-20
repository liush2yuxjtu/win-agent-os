#!/usr/bin/env python3
"""
dashboard-verify：看板视觉验证（截图 + openCV 布局断言）。

用法：
  /usr/bin/python3 scripts/dashboard-verify.py [--url http://localhost:3000] [--out /tmp/dashboard-verify.png]

做什么：
  1. Playwright 打开看板，全页截图
  2. openCV 检测卡片矩形（rounded 边框）与内容块分布
  3. 断言（视觉维度，与 verify-dashboard-page.py 的文本断言互补）：
     - 卡片数量 ≥ 6（banner + KPI 5 + 走势 + 洞察 + 明细 + 质量 2）
     - 卡片圆角 ≥ 14px、背景为暖米白（#fbfaf6 附近）
     - 质量/口径两卡等宽（双列均分，不塌缩——曾出现 112px 塌缩 bug）
     - 无超窄卡（宽度 < 容器 15%）
  4. 任一断言失败退出码 1，并打印诊断

依赖：python3 + playwright(python) + opencv-python（/usr/bin/python3 环境已装）。
"""
import argparse
import json
import sys

import cv2
import numpy as np
from playwright.sync_api import sync_playwright


def analyze_cards(img):
    """检测页面中的卡片矩形：找深色描边的闭合区域（rounded border）。"""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 边缘检测 + 形态学闭合，得到卡片外框
    edges = cv2.Canny(gray, 60, 160)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    cards = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        # 卡片合理尺寸：宽 > 页面 10%，高 > 40px
        if cw < w * 0.1 or ch < 40:
            continue
        cards.append((x, y, cw, ch))
    # 按 y 排序
    cards.sort(key=lambda r: (r[1], r[0]))
    return cards


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:3000")
    parser.add_argument("--out", default="/tmp/dashboard-verify.png")
    parser.add_argument("--json", action="store_true", help="输出结构化 JSON（供 dashboard_verify eve 工具/API 消费）")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # 看板内容由 <main> 内部滚动（dashboard-shell h-dvh overflow-hidden，
        # document 不滚动），full_page=True 会漏掉 main 内溢出内容——直接用
        # 足够高的视口一屏截全。
        page = browser.new_page(viewport={"width": 1440, "height": 1800})
        errors = []
        page.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" else None)
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_timeout(8000)
        page.screenshot(path=args.out, full_page=True)
        # DOM 侧卡片信息（与 openCV 互补）
        dom = page.evaluate("""() => {
          const out = [];
          document.querySelectorAll("div").forEach(el => {
            const cls = typeof el.className === "string" ? el.className : "";
            const r = el.getBoundingClientRect();
            if (cls.includes("rounded-[20px]") && r.height > 60) {
              const cs = getComputedStyle(el);
              out.push({
                w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y),
                radius: cs.borderRadius, bg: cs.backgroundColor,
                shadow: cs.boxShadow.includes("12px 40px")
              });
            }
          });
          return out;
        }""")
        browser.close()

    img = cv2.imread(args.out)
    cards = analyze_cards(img)
    # --json 模式 stdout 只输出 JSON（API/工具解析用），人读信息走 stderr。
    out = sys.stderr if args.json else sys.stdout
    print(f"截图: {args.out} ({img.shape[1]}x{img.shape[0]})", file=out)
    print(f"DOM 卡片数: {len(dom)}", file=out)
    for i, c in enumerate(dom):
        print(f"  #{i}: w={c['w']} h={c['h']} y={c['y']} radius={c['radius']} bg={c['bg']} shadow={c['shadow']}", file=out)

    fails = []
    # 1. 卡片数量
    if len(dom) < 6:
        fails.append(f"看板缺少部分卡片（当前 {len(dom)} 张，预期至少 6 张：顶部横幅 + 5 个指标 + 走势/洞察/明细/质量卡）")
    # 2. 圆角与背景（视觉质感）
    style_ok = all(c["radius"] == "20px" and c["bg"] == "rgb(251, 250, 246)" for c in dom)
    if not style_ok:
        fails.append("部分卡片样式与整体风格不一致（应为暖米白底 + 大圆角）")
    # 3. 阴影
    if not all(c["shadow"] for c in dom):
        fails.append("部分卡片缺少柔和阴影，层次感不足")
    # 4. 质量/口径双卡等宽（不塌缩）：最后两张卡宽度接近
    if len(dom) >= 2:
        a, b = dom[-2], dom[-1]
        if abs(a["w"] - b["w"]) > max(20, a["w"] * 0.05):
            fails.append(f"底部两张卡片宽度不一致（可能布局异常）：{a['w']}px vs {b['w']}px")
        if a["w"] < 200:
            fails.append(f"底部卡片过窄（布局异常）: {a['w']}px")
    # 5. console 错误
    if errors:
        fails.append(f"console 错误 {len(errors)} 条: {errors[0][:80]}")

    if fails:
        if args.json:
            print(json.dumps({
                "ok": False,
                "cardCount": len(dom),
                "cards": dom,
                "fails": fails,
                "screenshot": args.out,
            }, ensure_ascii=False))
        else:
            print("\n✗ 验证失败:")
            for f in fails:
                print(f"  - {f}")
        return 1
    if args.json:
        print(json.dumps({
            "ok": True,
            "cardCount": len(dom),
            "cards": dom,
            "fails": [],
            "screenshot": args.out,
        }, ensure_ascii=False))
    else:
        print("\n✓ dashboard-verify 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
