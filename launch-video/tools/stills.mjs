// Usage: node tools/stills.mjs <index.html|vertical.html> <outDir> t1,t2,...  [names]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [file, outDir, times, names] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(0);
const port = server.address().port;
const portrait = file.includes("vertical");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`http://localhost:${port}/${file}`);
await page.evaluate(() => document.fonts.ready);
fs.mkdirSync(outDir, { recursive: true });
const ts = times.split(",").map(Number);
const ns = names ? names.split(",") : ts.map((t) => `t${String(t).replace(".", "_")}`);
const id = portrait ? "vertical" : "main";
for (let i = 0; i < ts.length; i++) {
  await page.evaluate(([id, t]) => { window.__timelines[id].totalTime(t, true); }, [id, ts[i]]);
  await page.screenshot({ path: path.join(outDir, `${ns[i]}.png`) });
}
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
await browser.close();
server.close();
