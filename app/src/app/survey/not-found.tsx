import Link from "next/link";
import { Card } from "@/components/admin/ui";

export default function NotFound() {
  return (
    <Card title="설문을 찾을 수 없음">
      <p className="text-[14px] text-muted-text">삭제되었거나 주소가 잘못됨.</p>
      <Link href="/survey/list" className="mt-3 inline-block font-semibold underline">
        목록으로
      </Link>
    </Card>
  );
}
