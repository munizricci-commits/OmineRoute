import { releaseAntigravityLease } from "./antigravityRoutingState";

export async function releaseAntigravityLeaseOnPreDispatchError<T>(
  leaseId: string | null | undefined,
  work: () => Promise<T>
): Promise<T> {
  try { return await work(); } catch (error) { releaseAntigravityLease(leaseId); throw error; }
}

/** Transfer a fenced in-memory lease to the terminal lifecycle of an SSE body. */
export function holdAntigravityLeaseThroughResponse(
  response: Response, leaseId: string | null | undefined, signal: AbortSignal | null | undefined
): Response {
  if (!leaseId || !response.body) { releaseAntigravityLease(leaseId); return response; }
  const reader = response.body.getReader();
  let released = false;
  let abortListener: (() => void) | null = null;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    if (abortListener && signal) signal.removeEventListener("abort", abortListener);
    releaseAntigravityLease(leaseId);
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const { done, value } = await reader.read(); if (done) { releaseOnce(); controller.close(); } else controller.enqueue(value); }
      catch (error) { releaseOnce(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { releaseOnce(); } },
  });
  abortListener = () => { void reader.cancel(signal?.reason).catch(() => {}).finally(releaseOnce); };
  if (signal?.aborted) abortListener(); else signal?.addEventListener("abort", abortListener, { once: true });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function isStreamingAntigravityResponse(response: unknown): response is Response {
  return response instanceof Response && /(?:^|[,;\s])text\/event-stream(?:$|[;,\s])/i.test(response.headers.get("content-type") || "");
}
