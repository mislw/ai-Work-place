import { NativeAssistant } from "@/components/assistant/native-assistant";
import { HarnessEmbed } from "@/components/harness/harness-embed";

export default function AssistantPage({
  searchParams,
}: {
  searchParams?: { mode?: string };
}) {
  return searchParams?.mode === "harness" ? <HarnessEmbed /> : <NativeAssistant />;
}
