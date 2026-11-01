'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 把固定定位的按钮栏（顶部栏、底部导航、返回顶部按钮）挂到 <html> 下面，不放在 <body> 里。
 *
 * 为什么：本站用 <body> 作为滚动容器。iPhone 上手指在滚动惯性中点按时，如果点到的元素在滚动容器里面，
 * iOS 会把这次触摸用来“停住滚动”，页面（JS）根本收不到触摸事件，所以第一下只能停住滚动、按钮没反应，
 * 要再点一下才有效。LunaTV 的顶部栏不受这个影响。
 * 在手机上用书签脚本做对照实验：把顶部栏和底部导航移到 <html> 下面（不在 <body> 里）后，
 * 惯性滚动中点按钮立即响应，并且不会打断滚动。
 *
 * 做法：服务端渲染和首次渲染仍然放在原位（首屏马上可见、不影响水合），挂载后用 portal 移到 <html> 下的容器里。
 * 容器会带上 <body> 上的字体和文字颜色 class，保证外观和以前一致。
 */
export default function TopLayerPortal({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-top-layer', '');
    // 复制 body 上的字体、文字颜色 class（Next 字体 class、text-*、dark:text-*），不复制背景和高度
    el.className = document.body.className
      .split(/\s+/)
      .filter((c) => c && !/^(min-h|h-|w-|bg-|dark:bg-)/.test(c))
      .join(' ');
    document.documentElement.appendChild(el);
    setContainer(el);
    return () => {
      el.remove();
      setContainer(null);
    };
  }, []);

  if (!container) return <>{children}</>;
  return createPortal(children, container);
}
