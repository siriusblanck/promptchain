import { z } from "zod";

export const idSchema = z.guid();
const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message).transform((value) => (value === "" ? null : value));

export const chainFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Keep the name under 120 characters"),
  description: optionalText(600, "Keep the description under 600 characters"),
  isActive: z.boolean(),
});
export type ChainFormInput = z.infer<typeof chainFormSchema>;

export const stepFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80, "Keep the title under 80 characters"),
  instructions: z.string().trim().min(1, "Instructions are required").max(4000, "Instructions are limited to 4,000 characters"),
  modelId: z.guid({ error: "Choose a model" }),
});
export type StepFormInput = z.infer<typeof stepFormSchema>;

export const reorderSchema = z.object({ chainId: z.guid(), stepIds: z.array(z.guid()).min(1).max(20) });

export const readChainForm = (formData: FormData) =>
  chainFormSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    isActive: formData.get("isActive") === "on",
  });

export const readStepForm = (formData: FormData) =>
  stepFormSchema.safeParse({
    title: formData.get("title") ?? "",
    instructions: formData.get("instructions") ?? "",
    modelId: formData.get("modelId") ?? "",
  });

// Rows read from the database, parsed at the boundary.
export const modelRowSchema = z.object({
  id: z.guid(),
  name: z.string(),
  model_identifier: z.string(),
  modality: z.enum(["text", "image"]),
  is_active: z.boolean(),
});
export const stepRowSchema = z.object({
  id: z.guid(),
  step_order: z.number().int(),
  title: z.string(),
  instructions: z.string(),
  llm_models: modelRowSchema.nullable(),
});
export const chainRowSchema = z.object({
  id: z.guid(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
});
