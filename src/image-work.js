// One shared budget covers full images, crops, and OCR input preparation.
// Factories must allocate their pixel/scanline buffers only after admission.
export class ImageWorkQueue {
  constructor({ concurrency = 2, maxPending = 2 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxPending) || maxPending < 0) {
      throw new Error("Image work limits must be positive concurrency and nonnegative pending integers.");
    }
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.active = 0;
    this.pending = [];
  }

  get state() {
    return { active: this.active, pending: this.pending.length, concurrency: this.concurrency, maxPending: this.maxPending };
  }

  run(operation, { signal } = {}) {
    if (typeof operation !== "function") return Promise.reject(new Error("Image work requires an operation factory."));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.active >= this.concurrency && this.pending.length >= this.maxPending) {
      const error = new Error("Image processing is busy. Wait for an in-flight image request to finish before retrying.");
      error.code = "IMAGE_WORK_BUSY";
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const entry = { operation, signal, resolve, reject, started: false };
      entry.onAbort = () => {
        if (entry.started) return; // Running work retains its slot until it actually finishes.
        const index = this.pending.indexOf(entry);
        if (index !== -1) this.pending.splice(index, 1);
        signal.removeEventListener("abort", entry.onAbort);
        reject(signal.reason);
      };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      if (this.active < this.concurrency) this.start(entry);
      else this.pending.push(entry);
    });
  }

  start(entry) {
    entry.started = true;
    this.active++;
    const finish = ({ failed, error, value }) => {
      entry.signal?.removeEventListener("abort", entry.onAbort);
      this.active--;
      while (this.active < this.concurrency && this.pending.length) this.start(this.pending.shift());
      if (entry.signal?.aborted) entry.reject(entry.signal.reason);
      else if (failed) entry.reject(error);
      else entry.resolve(value);
    };
    Promise.resolve().then(() => {
      entry.signal?.throwIfAborted();
      return entry.operation();
    }).then((value) => finish({ value }), (error) => finish({ failed: true, error }));
  }
}

export const imageWorkQueue = new ImageWorkQueue();
