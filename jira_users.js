#!/usr/bin/env node

/* ──────────────────────────────────────────

 jira_users.js
 
 Fetches all users from Jira Cloud and writes them to jira_users.json.
 
 Usage:
   JIRA_BASE_URL=https://yourcompany.atlassian.net \
   JIRA_EMAIL=you@example.com \
   JIRA_API_TOKEN=your_token \
   node jira_users.js

────────────────────────────────────────── */

import { request } from "https";
import { writeFileSync } from "fs";
import { URL } from "url";

// ── Tokens ────────────────────────────────

const BASE_URL = "https://xxxxx.atlassian.net";
const EMAIL = "";
const API_TOKEN = "";
const OUTPUT_FILE = "jira_users.json";
const PAGE_SIZE = 50; // Jira Cloud max per request

// ── HTTP helper ───────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const auth = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    };

    const req = request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode === 401) {
          reject(
            new Error(
              "Authentication failed — check JIRA_EMAIL and JIRA_API_TOKEN.",
            ),
          );
          return;
        }
        if (res.statusCode === 403) {
          reject(
            new Error(
              "Access denied — your account may lack permission to list users.",
            ),
          );
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new Error(`Jira API returned HTTP ${res.statusCode}: ${body}`),
          );
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(
            new Error(
              `Failed to parse response as JSON: ${body.slice(0, 200)}`,
            ),
          );
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// ── Fetch all users (paginated) ───────────

async function fetchAllUsers() {
  const users = [];
  let startAt = 0;

  process.stdout.write("Fetching users");

  while (true) {
    const url =
      `${BASE_URL}/rest/api/3/users/search` +
      `?startAt=${startAt}&maxResults=${PAGE_SIZE}`;

    const page = await get(url);

    if (!Array.isArray(page)) {
      throw new Error(
        `Unexpected response shape: ${JSON.stringify(page).slice(0, 200)}`,
      );
    }

    users.push(...page);
    process.stdout.write(".");

    // Jira Cloud doesn't return a total for this endpoint — stop when the
    // page comes back shorter than the requested size.
    if (page.length < PAGE_SIZE) break;

    startAt += PAGE_SIZE;
  }

  process.stdout.write("\n");
  return users;
}

// ── Main ──────────────────────────────────

(async () => {
  try {
    const raw = await fetchAllUsers();

    // Map to a clean shape — include all account types (atlassian, app, customer, …)
    const users = raw.map((user) => ({
      displayName: user.displayName ?? null,
      accountId: user.accountId,
      emailAddress: user.emailAddress ?? null,
      accountType: user.accountType ?? null,
      active: user.active ?? null,
    }));

    writeFileSync(OUTPUT_FILE, JSON.stringify(users, null, 2), "utf8");

    console.log(`Wrote ${users.length} users to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
