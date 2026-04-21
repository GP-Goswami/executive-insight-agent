import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db } from "../db";
import { users, sessions, registerSchema, loginSchema, passwordResetTokens, forgotPasswordSchema, resetPasswordSchema } from "@shared/models/auth";
import { eq, and, gt, isNull } from "drizzle-orm";
import connectPgSimple from "connect-pg-simple";
import pkg from "pg";
import { sendPasswordResetEmail, isEmailConfigured } from "./email";
const { Pool } = pkg;

const PgSession = connectPgSimple(session);

// Parse DATABASE_URL explicitly to avoid issues with quoted strings in .env
const cleanDbUrl = (process.env.DATABASE_URL || "").replace(/^['"]|['"]$/g, "");
const parsedDbUrl = new URL(cleanDbUrl);
const pool = new Pool({
  host: parsedDbUrl.hostname,
  port: parseInt(parsedDbUrl.port || "5432", 10),
  user: parsedDbUrl.username,
  password: parsedDbUrl.password,
  database: parsedDbUrl.pathname.slice(1),
  ssl: parsedDbUrl.hostname !== "localhost" && parsedDbUrl.hostname !== "127.0.0.1",
});

export function setupAuth(app: Express): void {
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === "production";
  
  if (!sessionSecret && isProduction) {
    throw new Error("FATAL: SESSION_SECRET environment variable must be set in production.");
  }
  
  if (!sessionSecret) {
    console.warn("WARNING: SESSION_SECRET not set. Using insecure fallback for development only.");
  }

  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "sessions",
        createTableIfMissing: true,
      }),
      secret: sessionSecret || "dev-only-insecure-fallback-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: "lax",
      },
    })
  );
}

// Extend session type
declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

export function isAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: "Unauthorized" });
  }
}

export function registerAuthRoutes(app: Express): void {
  // Register new user
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parsed.error.flatten().fieldErrors 
        });
      }

      const { email, password, firstName, lastName } = parsed.data;

      // Check if user already exists
      const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existingUser.length > 0) {
        const existing = existingUser[0];
        // If legacy user without password, allow them to set password via registration
        if (!existing.password) {
          const hashedPassword = await bcrypt.hash(password, 10);
          await db.update(users).set({ 
            password: hashedPassword,
            firstName: firstName || existing.firstName,
            lastName: lastName || existing.lastName,
          }).where(eq(users.id, existing.id));
          
          req.session.userId = existing.id;
          const { password: _, ...userWithoutPassword } = existing;
          return res.status(200).json(userWithoutPassword);
        }
        return res.status(409).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const [newUser] = await db.insert(users).values({
        email,
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
      }).returning();

      // Set session
      req.session.userId = newUser.id;

      // Return user without password
      const { password: _, ...userWithoutPassword } = newUser;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parsed.error.flatten().fieldErrors 
        });
      }

      const { email, password } = parsed.data;

      // Find user
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Handle legacy users without password (from previous auth system migration)
      if (!user.password) {
        return res.status(403).json({ 
          message: "Password not set. Please use the password setup flow.",
          requiresPasswordSetup: true,
          userId: user.id
        });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Set session
      req.session.userId = user.id;

      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  // Set password for legacy users (from previous auth system migration)
  app.post("/api/auth/set-password", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password || password.length < 8) {
        return res.status(400).json({ message: "Email and password (min 8 characters) are required" });
      }

      // Find user
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Only allow if user doesn't have a password set
      if (user.password) {
        return res.status(400).json({ message: "Password already set. Please use login." });
      }

      // Hash and set password
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashedPassword }).where(eq(users.id, user.id));

      // Set session
      req.session.userId = user.id;

      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Set password error:", error);
      res.status(500).json({ message: "Failed to set password" });
    }
  });

  // Get current user
  app.get("/api/auth/user", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;
      const [user] = await db.select().from(users).where(eq(users.id, userId!)).limit(1);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });

  // Also support GET logout for redirects
  app.get("/api/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
      }
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });

  // Forgot password - generate reset token
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parsed.error.flatten().fieldErrors 
        });
      }

      const { email } = parsed.data;

      // Find user by email
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      
      // Always return success to prevent email enumeration
      if (!user) {
        return res.json({ 
          message: "If an account exists with this email, you will receive a password reset link.",
          emailSent: isEmailConfigured() // Indicate what would happen if user existed
        });
      }

      // Generate secure token
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Build the base URL for the reset link
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || req.hostname;
      const baseUrl = `${protocol}://${host}`;

      // Development mode bypass - ONLY when explicitly enabled and email not configured
      const isDevelopment = process.env.NODE_ENV !== "production";
      const emailConfigured = isEmailConfigured();

      if (!emailConfigured && isDevelopment) {
        // Development only: store token and return link directly
        await db.insert(passwordResetTokens).values({
          userId: user.id,
          token,
          expiresAt,
        });
        
        const resetLink = `/reset-password?token=${token}`;
        console.warn("DEVELOPMENT MODE: Email service not configured - returning reset link directly");

        return res.json({ 
          message: "Development mode: Email service not configured. Use the link below.",
          resetLink,
          emailSent: false,
          developmentMode: true
        });
      }

      if (!emailConfigured) {
        // Production without email - this is a configuration error
        console.error("CRITICAL: Password reset requested but email service not configured in production");
        return res.json({ 
          message: "If an account exists with this email, you will receive a password reset link.",
          emailSent: true // Don't reveal that email isn't configured
        });
      }

      // Send password reset email BEFORE storing token
      // This ensures tokens only exist for successfully delivered emails
      const emailResult = await sendPasswordResetEmail(email, token, baseUrl);
      
      if (!emailResult.success) {
        console.error(`Failed to send password reset email to ${email}: ${emailResult.error}`);
        // Don't store the token if email failed - don't expose the link
        return res.json({ 
          message: "If an account exists with this email, you will receive a password reset link.",
          emailSent: true // Don't reveal email sending failures
        });
      }

      // Only store token AFTER successful email delivery
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiresAt,
      });
      
      console.log(`Password reset email sent successfully to ${email}, token stored`);
      res.json({ 
        message: "If an account exists with this email, you will receive a password reset link.",
        emailSent: true
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  // Reset password - validate token and update password
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: parsed.error.flatten().fieldErrors 
        });
      }

      const { token, password } = parsed.data;

      // Find valid token
      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.token, token),
            gt(passwordResetTokens.expiresAt, new Date()),
            isNull(passwordResetTokens.usedAt)
          )
        )
        .limit(1);

      if (!resetToken) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Update user password
      await db.update(users)
        .set({ password: hashedPassword, updatedAt: new Date() })
        .where(eq(users.id, resetToken.userId));

      // Mark token as used
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetToken.id));

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
}
