"use client";

/**
 * 消息文本链接化（输出 markdown 字符串，交给 Streamdown 渲染）：
 *  - markdown 链接里的相对 href（[text](/x.html)）→ 补全为当前 origin 的绝对 URL
 *  - 裸相对文件路径（/reports/xxx.html）→ 转成可点链接，**显示文件名、隐藏地址**
 *    （[xxx.html](http://<当前origin>/reports/xxx.html)）
 *  - 裸绝对 URL：交付文件链接（路径以 .html/.pdf/... 结尾）→ 同样**显示文件名、隐藏地址**
 *    （[xxx.html](https://.../xxx.html)）；其余 URL → `<url>` autolink 语法
 *
 * origin 取用户当前访问地址 —— 任意部署（localhost:3000 / 公网域名 / 内网 IP）
 * 都指向正确地址，不锁死端口。
 *
 * 为什么必须补全为绝对 URL：Streamdown 的 rehype-sanitize 协议白名单只放行
 * http/https/mailto，相对路径 href（协议为空）会被剥掉，链接渲染成不可点。
 */
const ABS_URL_RE = /(?<!\]\()(https?:\/\/[^\s<>"']+)/g;
const REL_PATH_RE = /(?<![a-zA-Z0-9:/])\/[a-zA-Z0-9一-鿿_\-./%]+(?:\.html|\.pdf|\.png|\.jpe?g|\.svg|\.xlsx|\.csv)/g;
// markdown 链接内的相对 href（[text](/x.html)）。hoist 到模块级，
// 避免每条流式消息的文本都重新编译一次正则（js-hoist-regexp）。
const MARKDOWN_REL_HREF_RE = /\]\((\/[^\s)]+)\)/g;
// 交付文件 URL 判定：path 以 .html/.pdf/.png/... 结尾（与 REL_PATH_RE 的扩展名清单一致）。
const FILE_NAME_RE = /\.(?:html|pdf|png|jpe?g|svg|xlsx|csv)$/;

export function TextWithLinks({ text }: { readonly text: string }): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // 1) markdown 链接里的相对 href → 绝对 URL（[text](/x.html) → [text](abs)）
  let out = text.replace(MARKDOWN_REL_HREF_RE, (m, href) => `](${new URL(href, origin).href})`);
  // 2a) 反引号包裹的路径（`/reports/xxx.html`）→ 剥离反引号转成链接。
  //     模型习惯用反引号包交付路径，但 markdown 代码 span 内不会解析链接语法，
  //     若只在步骤 2 替换路径会残留反引号，整段被渲染成 <code> 源码（不可点）。
  out = out.replace(/`(\/[a-zA-Z0-9一-鿿_\-./%]+\.(?:html|pdf|png|jpe?g|svg|xlsx|csv))`/g, (m, path) => {
    const name = path.split("/").pop() ?? path;
    return `[${name}](${new URL(path, origin).href})`;
  });
  // 2) 裸相对路径 → [文件名](abs)，显示文件名、隐藏完整地址
  out = out.replace(REL_PATH_RE, (raw) => {
    const name = raw.split("/").pop() ?? raw;
    return `[${name}](${new URL(raw, origin).href})`;
  });
  // 3) 裸绝对 URL：交付文件链接 → [文件名](url)，与步骤 2 的裸路径行为一致
  //    （模型偶尔直接把完整 url 写进回复，兜底保证可见文字只显示文件名）；
  //    其余 URL → autolink。跳过已是 markdown 链接内的。
  out = out.replace(ABS_URL_RE, (raw) => {
    const pathname = new URL(raw).pathname;
    return FILE_NAME_RE.test(pathname)
      ? `[${pathname.split("/").pop() ?? raw}](${raw})`
      : `<${raw}>`;
  });
  return out;
}
