import type { Metadata } from "next";
import ChatApp from "@/components/chat/ChatApp";

export const metadata: Metadata = {
  title: "Kilpi for contractors | Vet subcontractors before you sign",
  description: "Find subcontractors for your construction project in Finland and vet them before you sign: tilaajavastuu registers and documents, references, licences, news and reviews, with a source for every finding. Request quotes and missing documents, and watch them during the project.",
};

export default function ChatPage() {
  return <ChatApp />;
}
