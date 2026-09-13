export interface HealthResponse {
  status: "ok";
  service: "stegloc-api";
}

const apiOrigin = import.meta.env.DEV ? "http://127.0.0.1:8000" : "";

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiOrigin}/api/health`);
  if (!response.ok) {
    throw new Error(`Health request failed: ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}
