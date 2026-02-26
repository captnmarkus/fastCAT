import IssuesPanel from "../../../components/ui/IssuesPanel";

type SeedingWarningBannerProps = {
  messages: string[];
};

export default function SeedingWarningBanner({ messages }: SeedingWarningBannerProps) {
  if (!messages || messages.length === 0) return null;
  return <IssuesPanel issues={messages} tone="danger" className="mb-3" />;
}
