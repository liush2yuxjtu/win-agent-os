import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// 注:next/font/google(Manrope/Newsreader)在无外网环境冷编译会挂(字体下载失败 → 500)。
// 已改为系统字体栈(--font-sans/--font-display 在 globals.css 定义,自带系统 fallback)。

export const metadata: Metadata = {
  title: "素材经营驾驶舱",
  description: "面向经销商的素材经营数据分析与 AI 助手平台",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
