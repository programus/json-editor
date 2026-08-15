import { constants, brotliCompress, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'

const gzipAsync = promisify(gzip)
const brotliAsync = promisify(brotliCompress)

/** Only text-like assets benefit; images and fonts are already compressed. */
const COMPRESSIBLE = /\.(js|mjs|css|html|json|svg|map|txt|xml|webmanifest)$/

/** Below this, framing overhead outweighs any saving. */
const MIN_BYTES = 1024

/**
 * Emit `.gz` and `.br` siblings for every compressible asset at build time.
 *
 * The app is fully static, so compression can happen once here rather than on
 * every request. The server then just picks the right file based on
 * `Accept-Encoding`, which costs it no CPU at all. Maximum compression levels
 * are used because build time is cheap compared to bytes on the wire.
 */
export function precompress(): Plugin {
  return {
    name: 'precompress',
    // Run after other plugins have finalized their assets.
    enforce: 'post',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const jobs: Promise<void>[] = []

      for (const [fileName, output] of Object.entries(bundle)) {
        if (!COMPRESSIBLE.test(fileName)) continue

        const source = output.type === 'chunk' ? output.code : output.source
        const raw = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source)
        if (raw.byteLength < MIN_BYTES) continue

        jobs.push(
          (async () => {
            const [gz, br] = await Promise.all([
              gzipAsync(raw, { level: constants.Z_BEST_COMPRESSION }),
              brotliAsync(raw, {
                params: {
                  [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
                  [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
                },
              }),
            ])

            this.emitFile({ type: 'asset', fileName: `${fileName}.gz`, source: gz })
            this.emitFile({ type: 'asset', fileName: `${fileName}.br`, source: br })
          })(),
        )
      }

      await Promise.all(jobs)
    },
  }
}
