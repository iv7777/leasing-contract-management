/** Anything that scrolls sideways (wide tables, the summary chips) shows a ‹ or › with a fade on the side that still has
 * hidden content, and tapping the arrow slides along. The arrows are drawn by the stylesheet from two attributes this
 * sets on the container: data-hint-left / data-hint-right. */

const HOST = ".ant-table-container, [data-scroll-host]";
const SCROLLER = ":scope > .ant-table-content, :scope > .ant-table-body, :scope > [data-scroll-body]";
/** The arrow's tap area, from the container's top corner (matches the stylesheet). */
const ARROW_W = 30;
const ARROW_H = 44;

interface Tracked {
  host: HTMLElement;
  scroller: HTMLElement;
  onScroll: () => void;
}

function scrollerOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>(SCROLLER);
}

function update(t: Tracked) {
  const { host, scroller } = t;
  const max = scroller.scrollWidth - scroller.clientWidth;
  const left = max > 2 && scroller.scrollLeft > 2;
  const right = max > 2 && scroller.scrollLeft < max - 2;
  if (left) host.setAttribute("data-hint-left", "");
  else host.removeAttribute("data-hint-left");
  if (right) host.setAttribute("data-hint-right", "");
  else host.removeAttribute("data-hint-right");
}

export function installScrollHints(): () => void {
  const tracked = new Map<HTMLElement, Tracked>();
  const resizer = new ResizeObserver((entries) => {
    for (const e of entries) {
      for (const t of tracked.values()) if (t.scroller === e.target || t.scroller.firstElementChild === e.target) update(t);
    }
  });

  let queued = false;
  const scan = () => {
    queued = false;
    // forget containers that have left the page
    for (const [host, t] of tracked) {
      if (!host.isConnected || !t.scroller.isConnected) {
        t.scroller.removeEventListener("scroll", t.onScroll);
        resizer.unobserve(t.scroller);
        if (t.scroller.firstElementChild) resizer.unobserve(t.scroller.firstElementChild);
        tracked.delete(host);
      }
    }
    document.querySelectorAll<HTMLElement>(HOST).forEach((host) => {
      const scroller = scrollerOf(host);
      const known = tracked.get(host);
      if (known && known.scroller === scroller) {
        update(known);
        return;
      }
      if (known) {
        known.scroller.removeEventListener("scroll", known.onScroll);
        resizer.unobserve(known.scroller);
        tracked.delete(host);
      }
      if (!scroller) return;
      const t: Tracked = { host, scroller, onScroll: () => update(t) };
      scroller.addEventListener("scroll", t.onScroll, { passive: true });
      resizer.observe(scroller);
      if (scroller.firstElementChild) resizer.observe(scroller.firstElementChild);
      tracked.set(host, t);
      update(t);
    });
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  };

  const mutations = new MutationObserver(queue);
  mutations.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", queue);
  queue();

  // Tapping an arrow slides most of the way along.
  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement | null;
    const host = el?.closest<HTMLElement>("[data-hint-left], [data-hint-right]");
    const t = host ? tracked.get(host) : undefined;
    if (!host || !t) return;
    const rect = host.getBoundingClientRect();
    if (e.clientY - rect.top < 0 || e.clientY - rect.top > ARROW_H) return;
    const dir = host.hasAttribute("data-hint-left") && e.clientX - rect.left <= ARROW_W ? -1 : host.hasAttribute("data-hint-right") && rect.right - e.clientX <= ARROW_W ? 1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    e.stopPropagation();
    t.scroller.scrollBy({ left: dir * t.scroller.clientWidth * 0.8, behavior: "smooth" });
  };
  document.addEventListener("click", onClick, true);

  return () => {
    mutations.disconnect();
    resizer.disconnect();
    window.removeEventListener("resize", queue);
    document.removeEventListener("click", onClick, true);
    for (const t of tracked.values()) t.scroller.removeEventListener("scroll", t.onScroll);
    tracked.clear();
  };
}
