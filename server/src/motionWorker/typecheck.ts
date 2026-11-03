/**
 * Typechecks a generated graphic against the real toolkit types: the source is
 * checked as a virtual file inside the Remotion project, with that project's
 * compiler options (strict, noUncheckedIndexedAccess, `@finalpost/motion` path).
 * Library source files are parsed once and reused across calls.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The Remotion project (holds src/motion and its node_modules types). */
export const motionToolkitRoot = path.resolve(process.env.MOTION_TOOLKIT_ROOT ?? path.join(here, '../../../remotion'));

const virtualFile = path.join(motionToolkitRoot, 'mg-fixtures/graphics/__worker_graphic__.tsx');

let options: ts.CompilerOptions | null = null;
const libraryFiles = new Map<string, ts.SourceFile | undefined>();
let previous: ts.Program | undefined;

function compilerOptions(): ts.CompilerOptions {
  if (!options) {
    const configPath = path.join(motionToolkitRoot, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) {
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    }
    options = {...ts.parseJsonConfigFileContent(config.config, ts.sys, motionToolkitRoot).options, noEmit: true};
  }
  return options;
}

/** Type errors in the graphic as `line L:C TSnnnn: message`; empty when it typechecks. */
export function typecheckGraphic(source: string): string[] {
  const opts = compilerOptions();
  const host = ts.createCompilerHost(opts, true);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (path.resolve(fileName) === virtualFile) {
      return ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TSX);
    }
    if (!libraryFiles.has(fileName)) {
      libraryFiles.set(fileName, readSourceFile(fileName, languageVersion, onError, shouldCreate));
    }
    return libraryFiles.get(fileName);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = fileName => path.resolve(fileName) === virtualFile || fileExists(fileName);

  const program = ts.createProgram({rootNames: [virtualFile], options: opts, host, oldProgram: previous});
  previous = program;
  const file = program.getSourceFile(virtualFile)!;
  const diagnostics = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
  return diagnostics.map(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file && diagnostic.start !== undefined) {
      const {line, character} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `line ${line + 1}:${character + 1} TS${diagnostic.code}: ${message}`;
    }
    return `TS${diagnostic.code}: ${message}`;
  });
}
