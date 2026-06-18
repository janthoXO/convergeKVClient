import dotenv from "dotenv";
import z from "zod";

dotenv.config();

export const EnvSchema = z
  .object({
    DEBUG: z.coerce.boolean().default(false),
    PORT: z.coerce.number().default(3030),
    DEBUG_TOKEN: z.string(),
  })

export type Env = z.output<typeof EnvSchema>;

export const env = EnvSchema.parse(process.env);
