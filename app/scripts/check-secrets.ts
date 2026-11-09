// 비밀 값 노출 검사: npm run check:secrets (CI 에서도 실행)
// 1) NEXT_PUBLIC_ 변수 이름에 비밀 값 이름이 섞였는지
// 2) 'use client' 파일이 서버 전용 모듈이나 비밀 환경변수를 참조하는지
// 3) 저장소 파일에 비공개 키가 그대로 들어 있는지
// 4) git 이 .env 파일을 추적하는지
// 5) 빌드 결과(.next/static)에 키 문자열이나 .env.local 의 비밀 값이 들어 있는지
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SECRET_NAMES = [
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SHEETS_ID",
  "NEXTAUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "CRON_SECRET",
  "RESEND_API_KEY",
];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage", ".vercel"]);
const problems: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");
const isEnvLocal = (f: string) => /(^|\/)\.env(\..+)?$/.test(rel(f)) && !rel(f).endsWith(".env.example");

// 1~3: 소스 검사
for (const file of walk(ROOT)) {
  if (isEnvLocal(file)) continue; // .gitignore 대상. 4)에서 추적 여부를 따로 봄
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|md|example|yml|yaml)$/.test(file)) continue;
  if (rel(file) === "scripts/check-secrets.ts") continue;
  const text = readFileSync(file, "utf8");

  // 머리표만 있는 코드(형식 검사)는 통과시키고, 실제 키 본문이 이어지는 경우만 잡음
  if (/-----BEGIN (RSA )?PRIVATE KEY-----(\\n|\r?\n)[A-Za-z0-9+/=]{40}/.test(text)) problems.push(`${rel(file)}: 비공개 키가 파일에 들어 있음`);

  for (const m of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
    if (/SECRET|PRIVATE|SERVICE|KEY|TOKEN|PASSWORD/.test(m[0]) && !m[0].endsWith("_URL")) {
      problems.push(`${rel(file)}: 공개 변수 이름에 비밀 값으로 보이는 '${m[0]}'`);
    }
  }

  if (/\.(tsx?|jsx?)$/.test(file) && /^\s*["']use client["']/.test(text)) {
    if (/from\s+["']@\/lib\/sheets/.test(text) || /from\s+["'][./]*.*lib\/sheets/.test(text)) {
      problems.push(`${rel(file)}: 클라이언트 컴포넌트가 시트 모듈을 가져옴`);
    }
    for (const n of SECRET_NAMES) {
      if (text.includes(`process.env.${n}`)) problems.push(`${rel(file)}: 클라이언트 컴포넌트가 ${n} 를 참조함`);
    }
  }
}

// 4: git 추적 여부
try {
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  for (const f of tracked.split("\n")) {
    if (/(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith(".env.example")) problems.push(`${f}: git 이 .env 파일을 추적함`);
    if (/service-account.*\.json$|credentials.*\.json$/.test(f)) problems.push(`${f}: 키 파일로 보이는 JSON 이 추적됨`);
  }
} catch {
  console.log("(git 저장소가 아니어서 추적 검사는 건너뜀)");
}

// 5: 빌드 결과 검사
const staticDir = path.join(ROOT, ".next", "static");
if (existsSync(staticDir)) {
  const secretValues: { name: string; value: string }[] = [];
  const envFile = path.join(ROOT, ".env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || !SECRET_NAMES.includes(m[1])) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      // 키는 앞부분 일부만으로도 충분히 식별됨
      const probe = m[1] === "GOOGLE_PRIVATE_KEY" ? v.replace(/\\n/g, "\n").split("\n")[1] ?? "" : v;
      if (probe.length >= 12) secretValues.push({ name: m[1], value: probe });
    }
  }
  const files = walk(staticDir).filter((f) => /\.(js|css|html|json)$/.test(f));
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (/PRIVATE KEY-----|iam\.gserviceaccount\.com/.test(text)) problems.push(`${rel(f)}: 빌드 결과에 키 관련 문자열`);
    for (const s of secretValues) if (text.includes(s.value)) problems.push(`${rel(f)}: 빌드 결과에 ${s.name} 값이 들어 있음`);
  }
  console.log(`빌드 결과 ${files.length}개 파일 검사함`);
} else {
  console.log("(.next/static 이 없어 빌드 결과 검사는 건너뜀. npm run build 뒤에 다시 실행하면 검사함)");
}

if (problems.length) {
  console.error(`\n비밀 값 노출 의심 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log("비밀 값 노출 검사 통과");
}
