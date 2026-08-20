import { redirect } from "next/navigation";

/**
 * WinBrain 原型入口：静态原型托管在 public/winbrain/（像素级原样部署，
 * HTML/CSS/JS 未转换），本路由仅做入口跳转。
 */
export default function WinBrainPage() {
  redirect("/winbrain/index.html");
}
