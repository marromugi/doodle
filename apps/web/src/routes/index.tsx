import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getGetHealthSuspenseQueryOptions } from "../api/generated/system/system";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(getGetHealthSuspenseQueryOptions()),
  component: Home,
});

function Home() {
  const { data: health } = useSuspenseQuery(getGetHealthSuspenseQueryOptions());
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">doodle</h1>
      <p>api: {health.data.status}</p>
    </main>
  );
}
