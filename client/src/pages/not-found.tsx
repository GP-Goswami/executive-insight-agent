import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background grid-pattern flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="flex h-20 w-20 mx-auto items-center justify-center rounded-2xl bg-muted/50 border border-white/10 mb-6">
          <AlertCircle className="h-10 w-10 text-muted-foreground" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">404</h1>
        <p className="text-xl text-muted-foreground mb-6">Page not found</p>
        <p className="text-sm text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/">
          <Button className="gradient-cyan-purple text-white glow-cyan gap-2" data-testid="button-go-home">
            <Home className="h-4 w-4" />
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
