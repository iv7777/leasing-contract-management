import { useEffect, useState } from "react";
import { FloatButton } from "antd";
import { VerticalAlignTopOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { pageScrollTop, scrollPageToTop } from "../lib/pageScroll";

/** The one "back to top" button for every page: appears after scrolling down a screen or so, and one tap scrolls
 * straight back up with the browser's own smooth scrolling (so it never needs a second tap). */
export default function BackToTop() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let queued = false;
    const check = () => {
      queued = false;
      setShow(pageScrollTop() > 400);
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(check);
    };
    check();
    // capture: a scroll inside <body> (phone) does not bubble up to the window
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  if (!show) return null;
  return (
    <FloatButton
      className="back-top"
      icon={<VerticalAlignTopOutlined />}
      aria-label={t("common.backToTop")}
      onClick={() => scrollPageToTop()}
    />
  );
}
