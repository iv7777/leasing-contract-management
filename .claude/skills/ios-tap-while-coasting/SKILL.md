---
name: ios-tap-while-coasting
description: Fix the iPhone/Safari problem where, after a quick flick-scroll, the first tap on the header, bottom nav or a floating button (e.g. back-to-top) only stops the scrolling and a second tap is needed. Use when the page scrolls with the browser window (the normal case) and fixed or sticky bars are part of it. Verified on a real iPhone in this app (v1.91.3). Complements ios-fixed-bars-tap, which only covers apps that already scroll inside <body>.
---

# iOS: first tap only stops the coasting scroll

## Symptom
Flick-scroll fast, tap a header button, bottom-nav button or the back-to-top button while the page is still
coasting: the scroll stops and the button does nothing; the second tap works.

## Root cause
On iOS a touch that lands on the scroller that is decelerating is used to stop it. The page gets no touch event, so
no JavaScript (fastclick, touchend->click(), tap relay) can fix it. When the browser WINDOW is the scroller, every
element is inside it, fixed and sticky bars included, so no bar can ever react on the first tap.
A bar only reacts at once if it is OUTSIDE the scroller that is coasting.

## What does NOT work (tried, failed on the device)
- Only moving the fixed bars under `<html>` (portal) while the window still scrolls. Same two taps.
- Turning a sticky header into a fixed one while the window still scrolls.
(The older skill `ios-fixed-bars-tap` suggests the portal alone; that works only if the app already scrolls
inside `<body>`.)

## The fix (verified on iPhone, Safari and Home Screen app)
Make `<body>` the scroller on the phone layout, and put every always-visible bar outside `<body>`:

1. CSS, phone breakpoint only (desktop and sideways phone keep window scrolling):
   ```css
   html, body, #root { height: 100%; margin: 0; }
   @media (max-width: 767px) {
     html, body { overflow: auto; }
     body { -webkit-overflow-scrolling: touch; }
   }
   ```
2. Copy `TopLayerPortal.tsx` into the app and wrap the title bar, bottom nav and back-to-top / floating buttons.
   It renders them as a child of `<html>` (after mount; first paint stays in place) and copies font and colour from
   the app layout. In this app those are set by Ant Design on `.ant-layout`, NOT on `<body>`: copying from `<body>`
   made the bottom bar render in Times New Roman. Pick the element that really carries the font.
3. A sticky header must become `position: fixed; top:0; left:0; right:0` on the phone, with a spacer of the same
   height in the flow (sticky outside the scroller would not stick).
4. Everything that reads or sets the window scroll must use the body on the phone. Copy `pageScroll.ts`
   (`pageScrollTop()`, `scrollPageToTop()`). Listen with `window.addEventListener("scroll", fn, { capture: true })`:
   a scroll inside `<body>` does not bubble to the window. `scrollIntoView` and `getBoundingClientRect` need no change.
5. Bump the version, build, deploy, test on a real iPhone.

## Checks after porting (all passed here)
- Headless Chromium (390x700, touch): `document.body.scrollTop` grows, `scrollY` stays 0, header and nav keep their
  y-position, back-to-top appears and scrolls `body` back to 0. Compare header/nav bounding boxes, computed
  font-family and colour before and after (they must be identical).
- Drawers/modals (antd sets `overflow:hidden` on body while open) keep the scroll position when closed.
- Desktop viewport still scrolls the window and back-to-top works there.
- Drawer mask and modals stack above the bars (their containers are in `<body>`, z-index 1000).
- Headless Chromium CANNOT reproduce iOS momentum scrolling: the real test is a flick on an iPhone, then one tap.

## Trade-offs to tell the user
- With `<body>` as the scroller Safari's address bar/toolbar may stop collapsing while scrolling (no effect in the
  Home Screen app).
- Only things outside the scroller benefit. Buttons inside the page content (table rows, tabs, cards) still need two
  taps while it coasts; that is normal iOS behaviour.
- Sideways phones (width >= 768px) use the desktop layout and keep window scrolling.

## If it still fails
Ship an in-app touch logger (see `ios-fixed-bars-tap/touch-logger.src.js`) behind a flag to see whether the tap
reaches the page at all (`touchstart` present or not, `touchcancel`).
