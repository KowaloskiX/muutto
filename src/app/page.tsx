import { redirect } from "next/navigation";

// The product lives at /chat; the first consumer prototype is kept at /classic.
export default function Home() {
  redirect("/chat");
}
