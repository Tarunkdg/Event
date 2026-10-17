export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function errorHandler(error, _request, response, _next) {
  if (error?.name === "ZodError") {
    return response.status(400).json({
      error: "Validation failed",
      details: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  if (error instanceof HttpError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({ error: "Request body must contain valid JSON" });
  }
  if (error?.type === "entity.too.large") {
    return response.status(413).json({ error: "Request body is too large" });
  }
  console.error("Request failed:", error);
  return response.status(500).json({ error: "An unexpected server error occurred" });
}
