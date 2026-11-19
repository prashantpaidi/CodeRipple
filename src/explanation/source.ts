import ignore from 'ignore';
import { ts } from 'ts-morph';
import { hasSourceExtension } from '../utils/paths.js';

const sensitiveComponent = /(?:^|[ ._-])(?:env|secrets?|credentials?|passwords?|passwd|tokens?|keys?|service[ ._-]?accounts?|id[._-]?(?:rsa|dsa|ecdsa|ed25519)|kubeconfig|aws|ssh|gnupg|keystores?|certs?|certificates?|pem|pfx|p12)(?:[ ._-]|$)/i;
const controlCharacters = /[\p{Cc}\p{Cf}]/u;

function isShareableComponent(part: string): boolean {
  const words = part.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2');
  return part !== '' && !part.startsWith('.') && !sensitiveComponent.test(words);
}

export function shareableSource(excludePaths: readonly string[]): (file: string) => boolean {
  // Ignore syntax supplies globs and directory matching. Exclusions are additive.
  const excluded = ignore().add(excludePaths.filter((pattern) => !pattern.startsWith('!')));
  return (file) => hasSourceExtension(file) &&
    !controlCharacters.test(file) && !/[\\:]/.test(file) &&
    file.split('/').every(isShareableComponent) &&
    !excluded.ignores(file);
}

/** Project source into syntax and opaque identifiers without copying repository text. */
export function projectSource(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const identifiers = new Map<string, string>();
  const parts: string[] = [];
  let cursor = 0;
  const lineBreaks = (text: string) => text.replace(/[^\n]/g, '');

  function visit(node: ts.Node): void {
    if (ts.isJSDoc(node)) return;
    const children = node.getChildren(parsed);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    const start = node.getStart(parsed);
    if (start < cursor || start >= node.end) return;
    const gap = source.slice(cursor, start);
    const breaks = lineBreaks(gap);
    parts.push(breaks || (gap ? ' ' : ''));
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const alias = identifiers.get(node.text) ?? `id${identifiers.size + 1}`;
      identifiers.set(node.text, alias);
      parts.push(alias);
    } else {
      parts.push(ts.tokenToString(node.kind) ?? '[redacted]');
    }
    parts.push(lineBreaks(source.slice(start, node.end)));
    cursor = node.end;
  }

  visit(parsed);
  parts.push(lineBreaks(source.slice(cursor)));
  // Keep line numbers aligned with the same LF/CRLF convention as retrieval.
  return parts.join('').split('\n');
}
