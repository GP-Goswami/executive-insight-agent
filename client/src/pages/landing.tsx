import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  LayoutDashboard,
  TrendingUp,
  Bot,
  BarChart3,
  Shield,
  Zap,
  ArrowRight,
} from "lucide-react";

const features = [
  {
    icon: LayoutDashboard,
    title: "Executive Overview",
    description: "Consolidated KPIs from GA4, GSC, SEMrush, and backlink data in one view.",
  },
  {
    icon: Bot,
    title: "AI Traffic Tracking",
    description: "Track visitors from ChatGPT, Gemini, Perplexity, and other AI platforms.",
  },
  {
    icon: TrendingUp,
    title: "Rankings Explorer",
    description: "Monitor keyword positions and identify top movers in your SEO strategy.",
  },
  {
    icon: BarChart3,
    title: "Custom Reports",
    description: "Generate PDF exports and shareable links with your selected filters.",
  },
  {
    icon: Shield,
    title: "Role-Based Access",
    description: "Secure access for executives, internal teams, and clients.",
  },
  {
    icon: Zap,
    title: "Real-Time Sync",
    description: "Automated daily data sync with retry and monitoring capabilities.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background grid-pattern">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-purple-500/5 to-transparent pointer-events-none" />
        
        <header className="relative container mx-auto px-4 py-6">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-cyan-purple glow-cyan-sm">
                <LayoutDashboard className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight">Reporting Agent</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/sign-in">
                <Button
                  variant="ghost"
                  className="text-muted-foreground"
                  data-testid="button-header-signin"
                >
                  Sign In
                </Button>
              </Link>
              <Link href="/sign-up">
                <Button
                  className="gradient-cyan-purple text-white glow-cyan"
                  data-testid="button-header-signup"
                >
                  Sign Up
                </Button>
              </Link>
            </div>
          </nav>
        </header>

        <main className="relative container mx-auto px-4 py-16 md:py-24">
          <div className="text-center max-w-4xl mx-auto mb-16">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                Executive Reporting
              </span>
              <br />
              <span className="text-foreground">& Client Dashboard</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              A single, trusted reporting layer that transforms multi-source operational 
              data into concise, role-based narratives for executives and clients.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href="/sign-up">
                <Button
                  size="lg"
                  className="gradient-cyan-purple text-white glow-cyan gap-2"
                  data-testid="button-hero-signup"
                >
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="border-white/10"
                data-testid="button-learn-more"
              >
                Learn More
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {features.map((feature) => (
              <Card
                key={feature.title}
                className="group border-white/10 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:glow-cyan-sm"
                data-testid={`feature-card-${feature.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-muted/50 text-cyan-400 group-hover:glow-cyan-sm transition-all">
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </main>

        <footer className="relative container mx-auto px-4 py-8 border-t border-white/10">
        </footer>
      </div>
    </div>
  );
}
