import type { Metadata } from "next";
import ChatApp from "@/components/chat/ChatApp";

export const metadata: Metadata = {
  title: "Kilpi | Check before you pay",
  description: "Hiring someone for your home in Finland? Kilpi finds them, checks them against the registers, their site and reviews, and gets you safe quotes, with a source for every finding.",
};

export default function ChatPage() {
  return <ChatApp />;
}
