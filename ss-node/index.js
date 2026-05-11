#!/usr/bin/env node

const { createServer } = require("node:http");
const { createReadStream, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = join(__dirname, "app");
const indexHtml = join(root, "index.html");

const browsers = [
  {
    names: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave-browser", "microsoft-edge"],
    args: (url, profile) => [
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--disable-infobars",
      "--start-fullscreen",
      "--kiosk",
      url,
    ],
  },
  {
    names: ["firefox"],
    args: (url) => ["--kiosk", url],
  },
];

function findBrowser() {
  if (process.env.BROWSER) return { command: process.env.BROWSER, args: browsers[0].args };

  for (const browser of browsers) {
    for (const name of browser.names) {
      const result = spawnSync("command", ["-v", name], { shell: true, stdio: "ignore" });
      if (result.status === 0) return { command: name, args: browser.args };
    }
  }

  return null;
}

const server = createServer((request, response) => {
  if (request.url !== "/" && request.url !== "/index.html") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  createReadStream(indexHtml).pipe(response);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = findBrowser();

  if (!browser) {
    console.error("No supported browser found. Set BROWSER=/path/to/browser and run `node .` again.");
    server.close();
    process.exitCode = 1;
    return;
  }

  const profile = mkdtempSync(join(tmpdir(), "ss-node-"));
  const child = spawn(browser.command, browser.args(url, profile), {
    detached: false,
    stdio: "ignore",
  });

  const shutdown = () => {
    server.close();
    rmSync(profile, { force: true, recursive: true });
  };

  child.on("exit", shutdown);
  child.on("error", (error) => {
    console.error(`Failed to launch ${browser.command}: ${error.message}`);
    shutdown();
    process.exitCode = 1;
  });
});
