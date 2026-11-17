// gzip for the sync engine (docs/sync-protocol.md §4.4): the WebView's own
// CompressionStream, handed in by the caller so tests can use Node's.

async function pipe(bytes, transform) {
    const writer = transform.writable.getWriter();
    // The write and close settle once the data has been read; a failure shows up in the reader.
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = transform.readable.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        length += value.length;
    }
    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}

/** `{ gzip, gunzip }`, each `(bytes) → Promise<Uint8Array>`. */
export function createSyncCodec({ CompressionStreamImpl, DecompressionStreamImpl }) {
    return {
        gzip: (bytes) => pipe(bytes, new CompressionStreamImpl('gzip')),
        gunzip: (bytes) => pipe(bytes, new DecompressionStreamImpl('gzip'))
    };
}
