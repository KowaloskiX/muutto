import { redirect } from "next/navigation";

// The pre-pivot contractor app (Kilpi) lives in git history; the product is Muutto at /move.
export default function Classic() {
  redirect("/move");
}
