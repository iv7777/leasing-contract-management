/** Prints a piece of HTML through a hidden frame (the browser's print dialog also offers "Save as PDF"). */
export function printHtml(title: string, body: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:14px/1.5 sans-serif;margin:24px;color:#222}h1{font-size:18px}h2{font-size:15px;margin-top:18px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 8px;text-align:left}td.r{text-align:right}</style>${body}`);
  doc.close();
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 2000);
}

export const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
