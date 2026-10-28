import { createClient } from "redis";

export async function enqueueToRedisQueue(
  queueName: string,
  taskName: string,
  jobId: number | null,
  args: Record<string, unknown>,
): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379/0";
  const client = createClient({ url: redisUrl });
  try {
    await client.connect();
    const now = new Date().toISOString();
    const payload = JSON.stringify({
      task: taskName,
      jobId,
      args,
      enqueuedAt: now,
      availableAt: now,
    });
    await client.rPush(`queue:${queueName}`, payload);
    return true;
  } catch (err) {
    console.error(`[redis] Failed to enqueue to queue:${queueName}`, err);
    return false;
  } finally {
    try {
      if (client.isOpen) {
        await client.quit();
      }
    } catch {
      // ignore disconnect errors
    }
  }
}
