/**
 * WP3T: words a generated graphic can show that are NOT in `props.content`. The worker's validation (motionWorker/contract.ts `checkSource`, `workerRules`, the typecheck, the compile
 * and the one-frame render) does not look at string literals or JSX text at all: the only thing that tells the model to take "every visible text and number" from `content` is a sentence
 * in its prompt (motionWorker/prompt.ts). So the component's source can bake a headline in, and a toolkit text treatment's words live in the brief, not in `content`.
 *
 * This module finds the words a viewer would read in a component's TSX source and in its brief's text treatment, and reports those that are neither in the transcript nor in
 * `props.content`. The matcher is the shared one (groundedText.ts). Pure apart from the TypeScript parser (no logger, `.env`, SDK or network).
 *
 * What counts as visible (conservative, to avoid dropping a good graphic for a configuration string):
 *  - JSX text between tags, and a string/template literal that is a JSX child (`{'Hello'}`);
 *  - a string literal given to a text-like attribute (`text`, `label`, `title`, ...) or stored under a text-like key in an object (`{label: 'Plan'}`);
 *  - an element of an array that is a phrase (two or more words made only of letters, so not a colour, a font stack, a path, a CSS value or an easing name);
 *  - the brief's `textTreatment.text`.
 * Tokens made only of digits and `$ % € £` are not words and are ignored.
 *
 * WP4C: a single bare word in a variable or array is collected only when the file SHOWS it (a bare word cannot otherwise be told from configuration):
 *  - `const|let NAME = '<string>'` when NAME is a JSX child (`{NAME}`) or the value of a text-like attribute (`label={NAME}`);
 *  - every string of `const NAME = ['a', 'b']` (all elements strings) when the array is mapped into such a position (`NAME.map(item => <Text>{item}</Text>)`, also through `.slice`/`.filter`)
 *    or indexed into one (`{NAME[i]}`, `label={NAME[0]}`).
 * A name that is never in a shown position (class names, colours, font names, easing, URLs, SVG paths held in variables) adds nothing. Imports are not followed; scoping is by name only.
 */
import ts from 'typescript';

import {ungroundedWords} from './groundedText.ts';

const TEXT_KEYS: ReadonlySet<string> = new Set(['text', 'label', 'sublabel', 'title', 'subtitle', 'detail', 'value', 'unit', 'caption', 'children', 'heading', 'headline', 'eyebrow', 'prefix', 'suffix', 'name', 'quote', 'author']);
const PHRASE = /^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)+$/u;
const URL_OR_COLOUR = /^(?:https?:|data:|blob:|file:|staticFile:|\/\/)|^#[0-9a-f]{3,8}$/i;

const keyName = (name: ts.PropertyName | ts.JsxAttributeName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : ts.isJsxNamespacedName(name) ? name.name.text : null;

const stringOf = (node: ts.Node | undefined): string | null => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ');
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return stringOf(node.expression);
  return null;
};

/** The strings a viewer would read in a graphic's TSX source (see the header for what counts). */
export function visibleStringsInSource(source: string): string[] {
  const file = ts.createSourceFile('graphic.tsx', source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const add = (text: string | null) => {
    if (text && text.trim() !== '' && !URL_OR_COLOUR.test(text.trim())) found.push(text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node.text.replace(/\s+/g, ' '));
    else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) add(stringOf(node.expression));
    else if (ts.isJsxAttribute(node)) {
      const name = keyName(node.name);
      const init = node.initializer;
      if (name && TEXT_KEYS.has(name) && init) add(ts.isJsxExpression(init) ? stringOf(init.expression) : stringOf(init));
    } else if (ts.isPropertyAssignment(node)) {
      const name = keyName(node.name);
      if (name && TEXT_KEYS.has(name)) add(stringOf(node.initializer));
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        const text = stringOf(element);
        if (text && PHRASE.test(text.trim())) add(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const text of shownConstantStrings(file)) add(text);
  return found;
}

// ---- WP4C: single words held in a variable or array that the file actually shows -----------------------------------------------------------------------------------------------

const peel = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) ? peel(node.expression) : node;

/** True when `node` is, possibly through parentheses, `as`, `!`, `?:` or `||`/`&&`/`??`, the expression of a JSX child or of a text-like JSX attribute. */
function inShownPosition(node: ts.Node): boolean {
  let current: ts.Node = node;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (!parent) return false;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent)) current = parent;
    else if (ts.isConditionalExpression(parent) && current !== parent.condition) current = parent;
    else if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) current = parent;
    else break;
  }
  const holder = current.parent;
  if (!holder || !ts.isJsxExpression(holder) || holder.expression !== current) return false;
  const owner = holder.parent;
  if (ts.isJsxElement(owner) || ts.isJsxFragment(owner)) return true;
  if (ts.isJsxAttribute(owner)) {
    const name = keyName(owner.name);
    return Boolean(name && TEXT_KEYS.has(name));
  }
  return false;
}

/** The identifier at the root of `NAME`, `NAME.slice(0, 2)`, `NAME.filter(...)` (property accesses and calls only), else null. */
function rootIdentifier(node: ts.Expression): string | null {
  let current = peel(node);
  for (;;) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isCallExpression(current)) current = peel(current.expression);
    else if (ts.isPropertyAccessExpression(current)) current = peel(current.expression);
    else return null;
  }
}

/** Is a reference to `name` anywhere under `root` (not as a property name) in a shown position? */
function referencedInShownPosition(root: ts.Node, name: string): boolean {
  let shown = false;
  const walk = (node: ts.Node) => {
    if (shown) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isJsxAttribute(parent) && parent.name === node);
      if (!isPropertyName && inShownPosition(node)) shown = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
  return shown;
}

function shownConstantStrings(file: ts.SourceFile): string[] {
  const scalars = new Map<string, string[]>();
  const arrays = new Map<string, string[]>();
  const declare = (map: Map<string, string[]>, name: string, values: string[]) => map.set(name, [...(map.get(name) ?? []), ...values]);
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const isConst = (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) !== 0;
      const initializer = peel(node.initializer);
      const text = stringOf(initializer);
      if (text !== null) declare(scalars, node.name.text, [text]);
      else if (isConst && ts.isArrayLiteralExpression(initializer) && initializer.elements.length > 0) {
        const strings = initializer.elements.map(element => stringOf(element));
        if (strings.every((value): value is string => value !== null)) declare(arrays, node.name.text, strings);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  const out: string[] = [];
  // A scalar is shown when the name itself is a JSX child or a text-like attribute value.
  for (const [name, values] of scalars) if (referencedInShownPosition(file, name)) out.push(...values);
  // An array is shown when it is indexed into such a position, or mapped with a callback whose item parameter reaches one.
  for (const [name, values] of arrays) {
    let shown = false;
    const walk = (node: ts.Node) => {
      if (shown) return;
      if (ts.isElementAccessExpression(node) && rootIdentifier(node.expression) === name && inShownPosition(node)) shown = true;
      else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && rootIdentifier(node.expression.expression) === name) {
        const callback = node.arguments[0];
        const parameter = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback.parameters[0] : undefined;
        if (callback && parameter && ts.isIdentifier(parameter.name) && referencedInShownPosition(callback, parameter.name.text)) shown = true;
      }
      ts.forEachChild(node, walk);
    };
    walk(file);
    if (shown) out.push(...values);
  }
  return out;
}

/** Every string leaf of `props.content` (the exact copy), joined: the words the graphic is allowed to show beyond the transcript. */
function contentText(node: unknown, out: string[] = [], depth = 0): string {
  if (depth <= 8) {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(item => contentText(item, out, depth + 1));
    else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node as Record<string, unknown>)) if (key !== 'icon' && key !== 'icons' && key !== 'recipeId') contentText(value, out, depth + 1); // WP11A: icon names are symbols
  }
  return out.join(' ');
}

export type BakedTextInput = {
  /** The component's TSX source, when known. */
  source?: string;
  /** The graphic's `props.content`. */
  content?: unknown;
  /** The Director's brief for the graphic: only `textTreatment.text` is read. */
  brief?: {textTreatment?: {text?: unknown}} | null;
  transcript: string;
};

/**
 * The words in the graphic's source and text treatment that are in neither the transcript nor `props.content`, lower-cased, in first-seen order, without repeats. Empty when the graphic shows
 * no extra words (or when neither a source nor a treatment is known: nothing is claimed about what cannot be read).
 */
export function bakedWordsNotAllowed(input: BakedTextInput): string[] {
  const strings = [...(input.source ? visibleStringsInSource(input.source) : [])];
  const treatment = input.brief?.textTreatment?.text;
  if (typeof treatment === 'string') strings.push(treatment);
  if (strings.length === 0) return [];
  const allowed = contentText(input.content);
  const out: string[] = [];
  for (const text of strings) {
    for (const word of ungroundedWords(text, input.transcript)) {
      if (/^[\d$%€£]+$/.test(word) || out.includes(word)) continue; // numbers and bare currency/percent signs are not words
      if (ungroundedWords(word, allowed).length === 0) continue; // the word is in props.content
      out.push(word);
    }
  }
  return out;
}

/** Drops a generated graphic that shows a word that is neither spoken nor in its `props.content`. Kept graphics are the same objects, in order, times untouched. */
export function dropGraphicsWithBakedText<G extends {id: string; props?: Record<string, unknown>}>(
  graphics: readonly G[],
  sources: ReadonlyMap<string, string>,
  briefs: ReadonlyMap<string, BakedTextInput['brief']>,
  transcript: string,
): {kept: G[]; dropped: Array<{graphic: G; words: string[]}>} {
  const kept: G[] = [];
  const dropped: Array<{graphic: G; words: string[]}> = [];
  for (const graphic of graphics) {
    const words = bakedWordsNotAllowed({source: sources.get(graphic.id), content: graphic.props?.content, brief: briefs.get(graphic.id), transcript});
    if (words.length > 0) dropped.push({graphic, words});
    else kept.push(graphic);
  }
  return {kept, dropped};
}
