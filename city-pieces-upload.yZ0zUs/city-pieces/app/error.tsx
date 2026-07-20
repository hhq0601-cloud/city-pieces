"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("City Pieces page error", error); }, [error]);
  return <main className="recovery-page"><span>🧩</span><h1>这块拼图暂时卡住了</h1><p>你的旅行仍保存在当前浏览器中。可以先重新加载页面；如果问题持续出现，请返回首页后再进入旅行。</p><button onClick={reset}>重新加载页面</button></main>;
}
