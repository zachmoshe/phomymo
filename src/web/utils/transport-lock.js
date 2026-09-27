// A raster header is followed by a fixed number of image bytes. Even a valid
// status command inserted there becomes image data and corrupts the stream.
// Lock complete jobs, not individual Bluetooth writes. Operations using this
// helper must not await another locked operation on the same transport.
const pending = new WeakMap();

export function withTransportLock(transport, operation) {
  const previous = pending.get(transport) || Promise.resolve();
  const result = previous.then(operation);
  // A failed/disconnected job must not prevent later jobs from running.
  pending.set(transport, result.catch(() => {}));
  return result;
}
