import type { Metadata } from "next";
import ChatApp from "@/components/chat/ChatApp";

export const metadata: Metadata = {
  title: "Kilpi | Text the job, get it done",
  description: "A personal assistant that finds and vets contractors in Finland, drafts quote requests and compares the replies, with your approval at every step.",
};

export default function ChatPage() {
  return <ChatApp />;
}
