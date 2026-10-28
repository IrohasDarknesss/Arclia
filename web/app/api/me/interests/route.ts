import { NextRequest } from "next/server";
import { dbQuery, withTransaction } from "@/lib/server/db";
import { ensureUserRow, requireAuthenticatedUser } from "@/lib/server/auth";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    await ensureUserRow(user.id);

    const res = await dbQuery<{ topic: string; weight: string | number }>(
      `
      SELECT topic, weight
      FROM user_interests
      WHERE user_id = $1::uuid
      ORDER BY weight DESC, topic ASC
      `,
      [user.id],
    );

    return jsonSuccess({
      interests: res.rows.map((r) => ({
        topic: r.topic,
        weight: Number(r.weight),
      })),
    });
  });
}

export async function PUT(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    await ensureUserRow(user.id);

    let body: { interests?: unknown };
    try {
      body = (await req.json()) as { interests?: unknown };
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "リクエストボディのJSON形式が不正です。");
    }

    if (!Array.isArray(body.interests) || body.interests.length > 20) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "興味トピック（interests）は0件以上20件以下の配列で指定してください。",
      );
    }

    const seenTopics = new Set<string>();
    const validated: Array<{ topic: string; weight: number }> = [];

    for (const item of body.interests) {
      if (!item || typeof item !== "object") {
        throw new ApiError(400, "VALIDATION_ERROR", "興味トピックの要素形式が不正です。");
      }
      const rawTopic = (item as { topic?: unknown }).topic;
      const rawWeight = (item as { weight?: unknown }).weight;

      const topic = typeof rawTopic === "string" ? rawTopic.trim() : "";
      if (!topic || topic.length > 128) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "topicは1文字以上128文字以内で指定してください。",
        );
      }
      if (seenTopics.has(topic)) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          `興味トピック「${topic}」が重複しています。`,
        );
      }
      seenTopics.add(topic);

      const weight =
        rawWeight === undefined || rawWeight === null
          ? 1.0
          : Number(rawWeight);
      if (!Number.isFinite(weight) || weight < 0.01 || weight > 999.99) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "weightは0.01以上999.99以下の数値で指定してください。",
        );
      }

      validated.push({
        topic,
        weight: Math.round(weight * 100) / 100,
      });
    }

    await withTransaction(async (client) => {
      await client.query(`DELETE FROM user_interests WHERE user_id = $1::uuid`, [
        user.id,
      ]);

      if (validated.length > 0) {
        const topics = validated.map((v) => v.topic);
        const weights = validated.map((v) => v.weight);
        await client.query(
          `
          INSERT INTO user_interests (user_id, topic, weight)
          SELECT $1::uuid, t.topic, t.weight
          FROM unnest($2::varchar[], $3::numeric[]) AS t(topic, weight)
          `,
          [user.id, topics, weights],
        );
      }
    });

    const sorted = [...validated].sort((a, b) =>
      b.weight !== a.weight
        ? b.weight - a.weight
        : a.topic.localeCompare(b.topic),
    );

    return jsonSuccess({
      interests: sorted,
    });
  });
}
