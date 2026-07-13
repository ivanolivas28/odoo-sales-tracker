import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { Task, TASK_PRIORITY, type TaskType } from "@/models/Task";

export async function GET() {
  await connectMongo();
  const tasks = await Task.find({ status: "pending" }).lean();

  tasks.sort((a, b) => {
    const priorityDiff = TASK_PRIORITY[a.type as TaskType] - TASK_PRIORITY[b.type as TaskType];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return NextResponse.json({ tasks });
}
