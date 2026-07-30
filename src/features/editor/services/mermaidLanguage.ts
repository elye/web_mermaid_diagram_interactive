/**
 * mermaidLanguage — very lightweight CodeMirror 6 stream language for Mermaid.
 *
 * Rationale: shipping a full Lezer grammar for every Mermaid dialect is out of
 * scope for the initial pass. A stream tokenizer gives us useful highlighting
 * (keywords, arrows, node shapes, comments, strings) with a fraction of the LOC.
 */
import { StreamLanguage, LanguageSupport } from '@codemirror/language';

const KEYWORDS = new Set([
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'journey',
  'subgraph',
  'end',
  'participant',
  'actor',
  'Note',
  'note',
  'class',
  'state',
  'section',
  'title',
  'TD',
  'TB',
  'BT',
  'LR',
  'RL',
]);

const mermaidStream = StreamLanguage.define({
  name: 'mermaid',
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;
    // Comments
    if (stream.match(/^%%.*$/)) return 'comment';
    // Strings
    if (stream.match(/^"([^"\\]|\\.)*"/)) return 'string';
    // Arrow-like operators
    if (stream.match(/^(-->|---|==>|-\.->|-.->|<--|--x|--o|-->\|)/)) return 'operator';
    // Node shape brackets
    if (stream.match(/^[[\](){}<>]/)) return 'bracket';
    // Numbers
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    // Identifiers / keywords
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_-]*/) as RegExpMatchArray | null;
    if (word) {
      if (KEYWORDS.has(word[0])) return 'keyword';
      return 'variableName';
    }
    stream.next();
    return null;
  },
});

export function mermaidLanguage(): LanguageSupport {
  return new LanguageSupport(mermaidStream);
}
