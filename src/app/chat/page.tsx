import { redirect } from "next/navigation";

// The contractor chat (Kilpi) was the project before the pivot; the product is now Muutto at /move.
export default function ChatPage() {
  redirect("/move");
}
