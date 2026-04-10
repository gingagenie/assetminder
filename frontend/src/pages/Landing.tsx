import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">AssetMinder</h1>
        <p className="text-muted-foreground text-lg">
          Service history for every piece of equipment your clients own.
        </p>
      </div>
      <Button size="lg" asChild>
        <a href="/auth/jobber/connect">Connect to Jobber</a>
      </Button>
    </div>
  );
}
