import type { Metadata } from "next";
import ChatApp from "@/components/chat/ChatApp";

export const metadata: Metadata = {
  title: "Kilpi | Tell me what you need done",
  description: "A personal butler for real-life errands: it researches with Exa, cites its sources and prepares the email, booking or reminder for your approval. Hiring a contractor? It checks them before you pay.",
};

export default function ChatPage() {
  return <ChatApp />;
}
