/**
 * Opens the live stream. React Native has no EventSource, so this reads a long-running
 * request as its text arrives (XMLHttpRequest progress events) and hands it to the parser.
 */
import { createSseParser, type SseEvent } from "./sse";

/** Start again after this much text: the request keeps everything it has received in memory. */
const ROTATE_AFTER_CHARS = 1_500_000;
/** The server sends a keep-alive line regularly. Silence this long means the connection is dead. */
const SILENCE_MS = 90_000;

export interface StreamOptions {
  url: string;
  headers: Record<string, string>;
  onOpen(): void;
  onEvent(e: SseEvent): void;
  /** Called once when the stream ends for any reason. `status` is the HTTP status (0 when the network failed). */
  onClose(info: { status: number; planned: boolean }): void;
}

/** Returns a function that closes the stream (no onClose call after that). */
export function openStream(options: StreamOptions): () => void {
  const xhr = new XMLHttpRequest();
  const parser = createSseParser(options.onEvent);
  let seen = 0;
  let done = false;
  let opened = false;
  let silence: ReturnType<typeof setTimeout> | null = null;

  const finish = (planned: boolean) => {
    if (done) return;
    done = true;
    if (silence) clearTimeout(silence);
    const status = xhr.status;
    try {
      xhr.abort();
    } catch {
      // already closed
    }
    options.onClose({ status, planned });
  };
  const heard = () => {
    if (silence) clearTimeout(silence);
    silence = setTimeout(() => finish(false), SILENCE_MS);
  };

  xhr.open("GET", options.url);
  xhr.responseType = "text";
  // Never attach cookies: the app signs in with a token only.
  xhr.withCredentials = false;
  for (const [name, value] of Object.entries(options.headers)) xhr.setRequestHeader(name, value);

  xhr.onreadystatechange = () => {
    if (done) return;
    if (xhr.readyState >= 2 && !opened && xhr.status === 200) {
      opened = true;
      options.onOpen();
    }
    if (xhr.readyState >= 2 && xhr.status !== 0 && xhr.status !== 200) finish(false);
    else if (xhr.readyState === 4) finish(false);
  };
  xhr.onprogress = () => {
    if (done) return;
    heard();
    const text = xhr.responseText ?? "";
    if (text.length > seen) {
      parser.feed(text.slice(seen));
      seen = text.length;
    }
    if (seen > ROTATE_AFTER_CHARS) finish(true);
  };
  xhr.onerror = () => finish(false);
  xhr.ontimeout = () => finish(false);
  heard();
  xhr.send();

  return () => {
    if (done) return;
    done = true;
    if (silence) clearTimeout(silence);
    try {
      xhr.abort();
    } catch {
      // already closed
    }
  };
}
