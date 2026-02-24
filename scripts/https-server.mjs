import { createServer } from "https";
import { readFileSync } from "fs";
import { parse } from "url";
import next from "next";

const port = parseInt(process.env.PORT || "4100", 10);
const hostname = "0.0.0.0";
const dev = false;

const httpsOptions = {
  key: readFileSync("certificates/localhost-key.pem"),
  cert: readFileSync("certificates/localhost.pem"),
};

const app = next({ dev, hostname, port, dir: process.cwd() });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, hostname, () => {
    console.log(`  ✓ Ready on https://${hostname}:${port}`);
  });
});
