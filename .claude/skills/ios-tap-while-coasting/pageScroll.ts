/** On a phone held upright the page scrolls inside <body> (see "Phones" in index.css), everywhere else the browser window scrolls.
 * These helpers hide that difference from the components that read or set the scroll position. */
const PHONE = "(max-width: 767px)";

export function bodyScrolls(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE).matches;
}

export function pageScrollTop(): number {
  return bodyScrolls() ? document.body.scrollTop : window.scrollY;
}

export function scrollPageToTop(): void {
  if (bodyScrolls()) document.body.scrollTo({ top: 0, behavior: "smooth" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}
