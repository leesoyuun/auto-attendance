import { existsSync, readFileSync } from "node:fs";

// Node 18 에는 --env-file 이 없어서 .env.local 을 직접 읽습니다.
const path = ".env.local";
if (existsSync(path)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    process.env[match[1]] ??= value;
  }
}
