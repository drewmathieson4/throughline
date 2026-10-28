// Where each account stands against the AI spend cap, and the reset (worker/spend.ts). A
// terminal job on purpose: there is no route for it, so nobody can find a way to reset
// their own cap; running it needs the Cloudflare account.
//
//   npm run spend -- show [--remote]            every account, most spent first
//   npm run spend -- reset <email> [--remote]   zero one account
//   npm run spend -- reset --all [--remote]     zero everyone (what to run when the total trips)
//
// Without --remote it is the local dev database.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const [command, target] = args.filter((a) => a !== "--remote");
// Strict on purpose: the address is quoted into SQL.
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

let sql: string;
if (command === "show" && !target) {
  sql = "SELECT email, name, demo, printf('%.4f', ai_spent_micro / 1000000.0) AS usd FROM users ORDER BY ai_spent_micro DESC";
} else if (command === "reset" && target === "--all") {
  sql = "UPDATE users SET ai_spent_micro = 0";
} else if (command === "reset" && target && EMAIL.test(target)) {
  sql = `UPDATE users SET ai_spent_micro = 0 WHERE lower(email) = lower('${target}')`;
} else {
  console.error("usage: npm run spend -- show [--remote] | reset <email> [--remote] | reset --all [--remote]");
  process.exit(2);
}

const res = spawnSync("npx", ["wrangler", "d1", "execute", "throughline-db", remote ? "--remote" : "--local", "--command", sql], { stdio: "inherit" });
process.exit(res.status ?? 1);
