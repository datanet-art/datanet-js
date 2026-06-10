/**
 * Browser IIFE entry point.
 * Exposes the DataNet class as window.DataNet after loading via <script> tag.
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@datanet/core@0.1/dist/datanet.browser.min.js"></script>
 *   <script>
 *     const client = new DataNet({ apiKey: 'ak_...' });
 *     await client.connect();
 *   </script>
 */
import { DataNet } from "./index.js";

(globalThis as unknown as Record<string, unknown>).DataNet = DataNet;
