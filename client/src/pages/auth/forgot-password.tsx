import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, ArrowLeft, Mail, CheckCircle } from "lucide-react";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [emailSent, setEmailSent] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordInput) => {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Request failed");
      }

      return response.json();
    },
    onSuccess: (data) => {
      setEmailSent(true);
      if (data.resetLink) {
        setResetLink(data.resetLink);
      }
      toast({
        title: data.emailSent ? "Email sent" : "Reset link ready",
        description: data.emailSent 
          ? "Check your inbox for the password reset link."
          : "Use the link provided to reset your password.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Request failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ForgotPasswordInput) => {
    forgotPasswordMutation.mutate(data);
  };

  if (emailSent) {
    return (
      <div className="min-h-screen bg-background grid-pattern flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-white/10 bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/20 text-green-400">
                <CheckCircle className="h-6 w-6" />
              </div>
            </div>
            <CardTitle className="text-2xl">
              {resetLink ? "Development Mode" : "Check your email"}
            </CardTitle>
            <CardDescription>
              {resetLink 
                ? "Email service not configured in development. Use the secure link below."
                : "If an account exists with the email you provided, you will receive a password reset link shortly. The link expires in 1 hour and can only be used once."
              }
            </CardDescription>
          </CardHeader>
          {resetLink && (
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs text-amber-400 mb-2 font-medium">
                  Development Only - Not available in production
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                  Click the button below to reset your password:
                </p>
                <Link
                  href={resetLink}
                  className="inline-block w-full text-center py-2 px-4 rounded-md gradient-cyan-purple text-white text-sm font-medium"
                  data-testid="link-reset-password"
                >
                  Reset Password
                </Link>
              </div>
            </CardContent>
          )}
          <CardFooter className="flex justify-center">
            <Link href="/sign-in">
              <Button variant="ghost" className="gap-2" data-testid="button-back-signin">
                <ArrowLeft className="h-4 w-4" />
                Back to Sign In
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background grid-pattern flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-white/10 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-cyan-purple glow-cyan">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl">Forgot password?</CardTitle>
          <CardDescription>
            Enter your email address and we'll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          className="bg-muted/50 border-white/10 pl-10"
                          data-testid="input-forgot-email"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full gradient-cyan-purple text-white"
                disabled={forgotPasswordMutation.isPending}
                data-testid="button-forgot-submit"
              >
                {forgotPasswordMutation.isPending ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Link href="/sign-in">
            <Button variant="ghost" className="gap-2 text-muted-foreground" data-testid="button-back-signin">
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
