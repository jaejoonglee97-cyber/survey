import { readFileSync } from "node:fs";
import path from "node:path";
import { importMd } from "@/lib/survey-core";

const FIX = path.resolve(import.meta.dirname, "..", "fixtures");
export const sample = readFileSync(path.join(FIX, "2026-healingcamp.md"), "utf8");
export const tpl = readFileSync(path.join(FIX, "template-event.md"), "utf8");

export function mdWithDeadline(deadline: string, slug = "healing2026"): string {
  return sample.replace(/deadline: .*/, "deadline: " + deadline).replace(/slug: .*/, "slug: " + slug);
}

/** 프로토타입 시험의 evMd 와 같음 */
export function evMd(slug: string, program: string, year: string, cat: string, deadline: string, target?: number): string {
  return tpl
    .replace(/slug: .*/, "slug: " + slug)
    .replace(/program: .*/, (year ? "year: " + year + "\n" : "") + "program: " + program)
    .replace(/category: .*/, "category: " + cat)
    .replace(/deadline: .*/, "deadline: " + deadline)
    .replace("target:", "target: " + (target ?? ""));
}

export const parse = (md: string) => importMd(md);

export function specOf(md: string) {
  const r = importMd(md);
  if (!r.ok) throw new Error("fixture md 해석 실패: " + r.errors.join("; "));
  return r.spec;
}
