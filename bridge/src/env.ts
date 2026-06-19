import dotenv from "dotenv";
import z from "zod";

dotenv.config();

export const EnvSchema = z.object({
  PORT: z.coerce.number().default(3030),
})

export type Env = z.output<typeof EnvSchema>;

export const env = EnvSchema.parse(process.env);
