import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";
const reply = fs.readFileSync("/tmp/r58-reply.txt", "utf8");
try {
  const html = renderToStaticMarkup(h(ReplyText, { text: reply, onBook: (() => undefined) as never }));
  console.log("RENDER OK, len", html.length, "| rows:", (html.match(/<tr/g) ?? []).length);
} catch (e) {
  console.log("RENDER CRASH:", (e as Error).message);
  console.log(((e as Error).stack ?? "").split("\n").slice(0, 14).join("\n"));
}
