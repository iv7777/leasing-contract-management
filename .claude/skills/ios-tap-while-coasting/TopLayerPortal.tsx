import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Renders its children (a fixed bar or button) as a sibling of <body>, directly under <html>, once the page has mounted.
 *
 * Why: on an iPhone, a tap that lands while the page is still coasting after a flick only stops the scrolling; the
 * page never sees it, so a bar or button inside the scrolling page needs a second tap. A bar that lives outside the
 * scrolled content (here: a child of <html>, not of <body>) is not part of what iOS is decelerating, so it reacts at
 * once. First paint keeps the element in place (nothing flashes); after mount it moves to the container below, which
 * copies the font and colour of the app layout so it looks exactly the same. React context, events and modals keep working
 * through the portal. */
export default function TopLayerPortal({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-top-layer", "");
    // the app's font and colour are set by Ant Design on the layout, not on <body>
    const cs = getComputedStyle(document.querySelector(".ant-layout") ?? document.body);
    el.style.fontFamily = cs.fontFamily;
    el.style.fontSize = cs.fontSize;
    el.style.lineHeight = cs.lineHeight;
    el.style.color = cs.color;
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
