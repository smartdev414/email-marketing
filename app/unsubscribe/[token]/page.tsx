import type { Metadata } from "next";

import { UnsubscribeForm } from "@/components/unsubscribe-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({ params }: PageProps<"/unsubscribe/[token]">) {
  const { token } = await params;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Unsubscribe</CardTitle>
          <CardDescription>
            Confirm below and we will stop emailing you. This also removes you from any campaign
            still queued.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UnsubscribeForm token={token} />
        </CardContent>
      </Card>
    </main>
  );
}
