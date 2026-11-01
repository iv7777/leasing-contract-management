---
name: ios-fixed-bars-tap
description: Fix iPhone/Safari bug where, while a page is still coasting after a flick-scroll, the first tap on a fixed header, bottom nav or floating button only stops the scrolling and the button needs a second tap. Use when a web app scrolls inside <body> (html,body{height:100%; overflow:auto}) or a scroll container, and fixed bars/buttons are its descendants. Includes a diagnosis bookmarklet and the verified fix (render fixed bars under <html> via a React portal).
---

# iOS: first tap only stops momentum scrolling

## Symptom
On iPhone (Safari tab and Home Screen app), flick-scroll, then tap a header/nav/floating
button while the page is still coasting: the scroll stops, the button does NOT fire, the second
tap works. A comparison site (same stack) responds instantly and keeps scrolling.

## Root cause (verified on device)
The app scrolls inside `<body>`. Fixed bars are descendants of that scroller. iOS uses a touch
that lands inside the scroll container to stop deceleration, and the page never receives the
touch at all (no touchstart, no click). So JavaScript cannot "catch and replay" the tap.
Do not waste time on tap-relay / fastclick / touchend->click() workarounds.

## Step 1: confirm with the logger (no deploy needed)
Headless Chromium CANNOT reproduce iOS momentum scrolling. Test on a real iPhone.
1. Make a Safari bookmark, edit its URL to the one-line string in `touch-logger.bookmarklet.txt`
   (readable source: `touch-logger.src.js`). Run it in a Safari TAB (bookmarklets don't run in
   Home Screen apps; if the bug only occurs there, ship the logger inside the app behind a flag).
2. Flick-scroll fast, tap the target once while it coasts; close any opened menu between tries.
3. Read the `TAP COASTING` lines: `click:YES` + `kept scrolling` = healthy.
   Only `drag` lines and no `TAP` line for your tap = the touch never reached the page = this bug.
   `touchcancel`/`pointercancel` = iOS took the touch for scrolling.
Check whether the app really scrolls <body>: in DevTools, `document.documentElement.scrollHeight`
equals the viewport height while `document.body.scrollHeight` is larger.

## Step 2: try the layout variant live (no deploy needed)
`layout-variant.bookmarklet.txt` asks for a variant and re-parents the fixed full-width bars that
are direct children of <body>: 1 = move under <html> (this is the one that worked), 2 = own GPU
layer (`translateZ(0)`; untested), 3 = both, 0 = undo. Re-run the logger test after each.

## Step 3: ship it
Use `TopLayerPortal.tsx` (copy into the app) and wrap every always-visible fixed element:
`<TopLayerPortal><header className="fixed top-0 ...">...</header></TopLayerPortal>`
Wrap: top bar, bottom nav, back-to-top / floating action buttons.
How it works: SSR and first client render keep the element in place (visible immediately, no
hydration mismatch); after mount it is portalled into a div appended to <html> (a sibling of
<body>). The container copies font and text-colour classes from <body> (not bg/height).

## Things to check after porting (all passed in the original app)
- Looks identical in light AND dark mode (dark class lives on <html>; fonts/colours were on
  <body>, hence the copied classes). Compare bounding boxes, computed font-family/colour.
- Server HTML still contains the bars (curl the page with a session cookie).
- No duplicate bars, no hydration/console errors; menus, theme toggle, navigation still work.
- Modals inside <body> still stack above the bars (body is not a stacking context).
- Unit tests: portal ends up as child of document.documentElement (query with
  `within(document.documentElement)`, `screen` only searches <body>); SSR test in a
  `@jest-environment node` file.

## Limits
- Buttons INSIDE the scrolling content (cards, tabs, filters) cannot use this: a tap on moving
  content still stops the scroll first. That is normal iOS behaviour.
- A cleaner long-term layout is a dedicated scroll container with the bars as siblings so <body>
  never scrolls. NOT verified on iOS; needs all scroll listeners / scrollTo calls rewritten.
  Only consider it for a new app.
- Only variant 1 (move under <html>) was verified on a device.

## Related iOS findings from the same project
- Opaque `apple-mobile-web-app-status-bar-style` values or translucent ones: newer iOS blurs/tints
  the translucent status-bar area in Home Screen apps. Safest is to NOT set the
  `apple-mobile-web-app-*` meta tags (let manifest `display: standalone` decide) and keep the
  header at `top-0` without relying on env(safe-area-inset-top).
- iOS auto-zooms focused inputs with font-size < 16px: use `font-size: max(16px, 1em)` on inputs
  under `@media (pointer: coarse)`.
- Fixed back-to-top buttons: position them at `bottom: calc(<nav height> + env(safe-area-inset-bottom) + 1rem)`.
