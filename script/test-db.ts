import "dotenv/config";
import { db } from "../server/db";
import { users } from "@shared/models/auth";

async function run() {
  try {
    const res = await db.insert(users).values({ email: 'test2@test.com', password: 'testpassword' }).returning();
    console.log("Success:", res);
  } catch (error) {
    console.error("DB Error:", error);
  }
}
run();
