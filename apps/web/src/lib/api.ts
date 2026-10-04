export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  session?: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'x-session-id': session } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? 'Request failed', response.status);
  return data;
}
