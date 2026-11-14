import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = {
  title: "Feynman AI",
  description: "Learn it by teaching it: explain a topic to an AI student and get a Knowledge Gap Report.",
};

export default function Home() {
  return <Workspace />;
}
