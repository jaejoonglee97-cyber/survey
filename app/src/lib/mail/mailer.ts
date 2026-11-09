// 결과 요약 메일 발송. 본문은 일반 텍스트(HTML 없음)이고 수치만 담음(서술 의견 원문 없음).
//   MAIL_PROVIDER=log    : 실제로 보내지 않고 서버 로그에 제목·받는 사람만 남김(개발·시험용, 기본값)
//   MAIL_PROVIDER=resend : Resend API 로 발송(RESEND_API_KEY, MAIL_FROM 필요)

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

export interface Mailer {
  readonly kind: string;
  send(msg: MailMessage): Promise<void>;
}

/** 개발용: 보낸 메일을 메모리에 모아 둠(시험에서 확인). 로그에는 본문을 남기지 않음 */
export class LogMailer implements Mailer {
  readonly kind = "log";
  readonly outbox: MailMessage[] = [];
  constructor(private readonly quiet = false) {}
  async send(msg: MailMessage) {
    this.outbox.push(msg);
    if (!this.quiet) console.info(`[mail:log] 받는 사람 ${msg.to.length}명 · 제목: ${msg.subject}`);
  }
}

export class ResendMailer implements Mailer {
  readonly kind = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async send(msg: MailMessage) {
    const res = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text }),
    });
    // 오류 내용에 키가 섞이지 않도록 상태 코드만 알림
    if (!res.ok) throw new Error(`메일 발송 실패(HTTP ${res.status})`);
  }
}

export function createMailer(env: Record<string, string | undefined>): Mailer {
  const kind = (env.MAIL_PROVIDER ?? "log").trim();
  if (kind === "resend") {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error("MAIL_PROVIDER=resend 에는 RESEND_API_KEY, MAIL_FROM 이 필요함");
    return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  }
  if (kind !== "log") throw new Error(`MAIL_PROVIDER 값이 올바르지 않음(log 또는 resend): ${kind}`);
  return new LogMailer();
}

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

/** 받는 사람: ADMIN_NOTIFY_EMAIL(쉼표로 여러 명) + 설문을 만든 담당자. 중복·형식 오류 제거 */
export function recipients(adminNotify: string | undefined, createdBy: string): string[] {
  const list = [...(adminNotify ?? "").split(","), createdBy].map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e));
  return [...new Set(list)];
}
