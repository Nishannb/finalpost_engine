/**
 * The generated-graphic contract: what a motion-graphic TSX file may contain
 * and how it becomes the CommonJS module the Remotion loader evaluates
 * (remotion/src/generated/loader.ts). Shared by the Claude worker and the
 * mg:fixture dev tool so both enforce exactly the same rules.
 *
 * The source checks are a conservative review gate, not a sandbox: the module
 * only ever receives the loader's require shim (React, a Remotion subset and
 * @finalpost/motion), and runs inside the render browser.
 */

import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

import {build, type Plugin} from 'esbuild';

/** R2 key prefix for compiled graphic modules (content-addressed by sha256). */
export const MOTION_MODULE_PREFIX = 'ai-video/motion-graphics/v0/';

export const ALLOWED_IMPORTS = new Set(['react', 'react/jsx-runtime', 'remotion', '@finalpost/motion']);

/** Must match `remotionSubset` in remotion/src/generated/loader.ts. */
export const ALLOWED_REMOTION_NAMES = new Set([
  'AbsoluteFill',
  'Easing',
  'Sequence',
  'Series',
  'interpolate',
  'interpolateColors',
  'random',
  'spring',
  'useCurrentFrame',
]);

/** Source-level denylist, run on comment-stripped source. */
const BANNED: Array<[RegExp, string]> = [
  [/\bfetch\s*\(/, 'network: fetch'],
  [/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/, 'network API'],
  [/https?:\/\//, 'network: URL literal'],
  [/\bimport\s*\(|\bimport\.meta\b/, 'dynamic import'],
  [/\brequire\s*\(/, 'require()'],
  [/\beval\s*\(|\bFunction\s*\(/, 'code evaluation'],
  [/\bconstructor\b|\b__proto__\b|\bprototype\b|\bReflect\b|\bProxy\b|\bWebAssembly\b/, 'reflection / prototype access'],
  [/\bMath\.random\b|\bDate\b|\bperformance\b/, 'non-deterministic API'],
  [/\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/, 'timers'],
  [/\b(window|document|globalThis|localStorage|sessionStorage|navigator)\b/, 'global object access'],
  [/(?<![.\w$])(self|location|opener|process)\b/, 'global object access'],
  [/\bnew\s+(Image|Audio|Worker|SharedWorker)\b/, 'resource-loading constructor'],
  [/\b(useState|useEffect|useLayoutEffect|useRef)\b/, 'stateful hook'],
  [/\buseVideoConfig\b/, 'useVideoConfig (size must come from props)'],
  [/dangerouslySetInnerHTML|<script\b|<iframe\b|<foreignObject\b/, 'unsafe element'],
  [/<(img|image|video|audio|source|link|object|embed)\b/, 'raw media element (use AssetImage from @finalpost/motion)'],
  [/url\(\s*['"]?(?!#)/, 'CSS url() to a non-fragment'],
  [/\bid\s*=\s*(?:['"]|\{\s*['"`])/, 'hard-coded SVG id (use useSvgId() from @finalpost/motion)'],
];

export const MAX_SOURCE_BYTES = 40_000;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Contract violations in a graphic's TSX source; empty when it passes. */
export function checkSource(source: string): string[] {
  const errors: string[] = [];
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) {
    errors.push(`source larger than ${MAX_SOURCE_BYTES} bytes`);
  }
  const code = stripComments(source);
  for (const [pattern, label] of BANNED) {
    const match = code.match(pattern);
    if (match) {
      const line = code.slice(0, match.index).split('\n').length;
      errors.push(`line ${line}: banned ${label} (${match[0].trim()})`);
    }
  }
  for (const match of code.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, clause = '', specifier = ''] = match;
    if (!ALLOWED_IMPORTS.has(specifier)) {
      errors.push(`import from "${specifier}" is not allowed`);
      continue;
    }
    if (specifier === 'remotion' && !/^type\b/.test(match[0].replace(/^import\s+/, ''))) {
      const names = clause.replace(/[{}]/g, '').split(',').map(name => name.trim().split(/\s+as\s+/)[0]!.replace(/^type\s+/, ''));
      for (const name of names.filter(Boolean)) {
        if (!ALLOWED_REMOTION_NAMES.has(name)) {
          errors.push(`remotion export "${name}" is not allowed`);
        }
      }
    }
  }
  if (!/export\s+default\b/.test(code)) {
    errors.push('missing default export');
  }
  return errors;
}

const importAllowlist: Plugin = {
  name: 'generated-graphic-imports',
  setup(pluginBuild) {
    pluginBuild.onResolve({filter: /.*/}, args => {
      if (args.kind === 'entry-point') {
        return undefined;
      }
      if (ALLOWED_IMPORTS.has(args.path)) {
        return {path: args.path, external: true};
      }
      return {errors: [{text: `import "${args.path}" is not allowed in a generated graphic`}]};
    });
  },
};

export type CompiledModule = {
  code: string;
  sha256: string;
  bytes: number;
  gzipBytes: number;
  compileMs: number;
};

export class CompileError extends Error {
  readonly messages: string[];
  constructor(messages: string[]) {
    super(`compile failed:\n  - ${messages.join('\n  - ')}`);
    this.messages = messages;
  }
}

/**
 * TSX → minified CommonJS with only the allowed imports left external.
 * Throws CompileError with esbuild's messages. Does not run the contract check.
 */
export async function compileGraphicSource(source: string, sourcefile = 'graphic.tsx'): Promise<CompiledModule> {
  const started = Date.now();
  let code: string;
  try {
    const result = await build({
      stdin: {contents: source, loader: 'tsx', sourcefile},
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      minify: true,
      legalComments: 'none',
      logLevel: 'silent',
      plugins: [importAllowlist],
    });
    code = result.outputFiles[0]!.text;
  } catch (error) {
    const failures = (error as {errors?: Array<{text: string; location?: {line: number; column: number} | null}>}).errors;
    if (failures?.length) {
      throw new CompileError(
        failures.map(failure => (failure.location ? `line ${failure.location.line}:${failure.location.column + 1}: ${failure.text}` : failure.text)),
      );
    }
    throw error;
  }
  return {
    code,
    sha256: createHash('sha256').update(code).digest('hex'),
    bytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(code).length,
    compileMs: Date.now() - started,
  };
}
