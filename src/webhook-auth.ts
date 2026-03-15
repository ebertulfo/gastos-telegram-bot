export function verifyWebhookSecret(
  incomingHeader: string | undefined,
  expectedSecret: string
): boolean {
  const encoder = new TextEncoder();
  const incoming = encoder.encode(incomingHeader ?? "");
  const expected = encoder.encode(expectedSecret);

  if (incoming.byteLength !== expected.byteLength) {
    return false;
  }

  // crypto.subtle.timingSafeEqual is a Cloudflare Workers extension not in the standard DOM typings
  const subtle = crypto.subtle as typeof crypto.subtle & {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(incoming, expected);
}
