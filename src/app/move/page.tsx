import type { Metadata } from "next";
import MoveApp from "@/components/move/MoveApp";

export const metadata: Metadata = {
  title: "Muutto | Where to live for your new job in the Helsinki region",
  description: "Tell us where you will work and what matters. Areas ranked by commute, shops, schools, air, noise and works nearby, with live listings, deep research on a flat and a viewing request you approve. Every fact cited.",
};

export default function MovePage() {
  return <MoveApp />;
}
