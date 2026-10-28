import { NextResponse } from "next/server";

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function jsonSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    {
      status: "success",
      data,
    },
    { status },
  );
}

export function jsonError(
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      status: "error",
      error: {
        code,
        message,
        ...(details || {}),
      },
    },
    { status: statusCode },
  );
}

export async function handleApiRoute(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      (err as { digest?: string }).digest === "DYNAMIC_SERVER_USAGE"
    ) {
      throw err;
    }
    if (err instanceof ApiError) {
      return jsonError(err.statusCode, err.code, err.message, err.details);
    }
    console.error("[API Unhandled Error]", err);
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "サーバー内部エラーが発生しました。時間をおいて再度お試しください。",
    );
  }
}
