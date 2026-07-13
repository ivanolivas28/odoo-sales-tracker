import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const TASK_TYPES = ["urgent_call", "hot_followup", "prospecting", "reactivation"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_PRIORITY: Record<TaskType, number> = {
  urgent_call: 1,
  hot_followup: 2,
  prospecting: 3,
  reactivation: 4,
};

const taskSchema = new Schema({
  key: { type: String, required: true, unique: true },
  type: { type: String, enum: TASK_TYPES, required: true },
  partnerId: { type: Number, required: true },
  partnerName: { type: String, required: true },
  refModel: { type: String },
  refId: { type: Number },
  reason: { type: String, required: true },
  amount: { type: Number },
  status: { type: String, enum: ["pending", "done"], default: "pending" },
  completedAt: { type: Date },
  nextFollowUpDate: { type: Date },
  generatedContent: {
    channel: { type: String, enum: ["whatsapp", "email", "no_phone"] },
    subject: { type: String },
    message: { type: String },
    phone: { type: String },
    email: { type: String },
    waLink: { type: String },
  },
}, { timestamps: true });

export type TaskDoc = InferSchemaType<typeof taskSchema>;

export const Task = mongoose.models.Task ?? mongoose.model("Task", taskSchema);
