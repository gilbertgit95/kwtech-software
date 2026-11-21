import { createInterface } from 'node:readline';

/**
 * Questions on a terminal, or answers read from standard input (#206).
 *
 * A person at the server PC gets a terminal: answers echo as typed, except a
 * password, which shows nothing. The Docker installer and the tests have no
 * terminal: they pipe one answer per line, and a refused answer stops the
 * script rather than asking forever, since nobody is there to type again.
 */
export interface Prompter {
  /** True when a person is typing: a refused answer is asked again. */
  readonly interactive: boolean;
  /** One line, with `fallback` taken on an empty answer. */
  ask(question: string, fallback?: string): Promise<string>;
  /** One line that is never shown, for a password. */
  askHidden(question: string): Promise<string>;
  say(line?: string): void;
  close(): void;
}

/** The prompter for this process: interactive on a terminal, piped otherwise. */
export function createPrompter(): Prompter {
  return process.stdin.isTTY ? terminalPrompter() : pipedPrompter();
}

function terminalPrompter(): Prompter {
  // Replaced after every password: see askHidden.
  let rl = createInterface({ input: process.stdin, output: process.stdout });

  function ask(question: string, fallback?: string): Promise<string> {
    const shown = fallback ? `${question} [${fallback}]: ` : `${question}: `;
    return new Promise((resolve) => {
      rl.question(shown, (answer) => resolve(answer.trim() || fallback || ''));
    });
  }

  /**
   * ⚠ Raw mode, reading key by key, because readline has no hidden input.
   * And readline is CLOSED for it, not paused: a paused readline still
   * listens to the keyboard and echoed every key of the password (found
   * under a pseudo-terminal, #206). A fresh one is opened after Enter.
   * Backspace edits it; Ctrl+C stops the script (nothing is written before
   * the summary is confirmed).
   */
  function askHidden(question: string): Promise<string> {
    rl.close();
    process.stdout.write(`${question}: `);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    return new Promise((resolve) => {
      let value = '';
      const onData = (chunk: Buffer) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\r' || char === '\n') {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            process.stdout.write('\n');
            rl = createInterface({ input: process.stdin, output: process.stdout });
            resolve(value);
            return;
          }
          if (char === '\u0003') {
            process.stdout.write('\nStopped. Nothing was written.\n');
            process.exit(130);
          }
          if (char === '\u007f' || char === '\b') {
            value = value.slice(0, -1);
            continue;
          }
          value += char;
        }
      };
      stdin.on('data', onData);
    });
  }

  return {
    interactive: true,
    ask,
    askHidden,
    say: (line = '') => console.log(line),
    close: () => rl.close(),
  };
}

function pipedPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  const waiting: Array<(line: string | null) => void> = [];
  let ended = false;
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    for (const next of waiting.splice(0)) next(null);
  });

  async function nextLine(question: string): Promise<string> {
    const queued = lines.shift();
    if (queued !== undefined) return queued;
    if (ended) throw new Error(`No answer for "${question}": the input ended.`);
    const line = await new Promise<string | null>((resolve) => waiting.push(resolve));
    if (line === null) throw new Error(`No answer for "${question}": the input ended.`);
    return line;
  }

  return {
    interactive: false,
    async ask(question, fallback) {
      const answer = (await nextLine(question)).trim();
      return answer || fallback || '';
    },
    // Not echoed: the piped answers are never printed, passwords least of all.
    askHidden: (question) => nextLine(question),
    say: (line = '') => console.log(line),
    close: () => rl.close(),
  };
}

/**
 * Asks until `check` accepts the answer (null), saying why each refused one
 * was refused. Piped, the first refusal stops the script with that reason.
 */
export async function askChecked(
  prompter: Prompter,
  question: string,
  check: (answer: string) => string | null,
  fallback?: string,
): Promise<string> {
  for (;;) {
    const answer = await prompter.ask(question, fallback);
    const refusal = check(answer);
    if (refusal === null) return answer;
    if (!prompter.interactive) throw new Error(`${question}: ${refusal}`);
    prompter.say(`  ✗ ${refusal}`);
  }
}

/** A yes/no question; `fallback` is the answer on Enter. */
export async function askYesNo(prompter: Prompter, question: string, fallback: boolean): Promise<boolean> {
  const answer = await askChecked(prompter, `${question} (${fallback ? 'Y/n' : 'y/N'})`, (value) =>
    /^(y|yes|n|no)?$/i.test(value.trim()) ? null : 'Answer y or n.',
  );
  if (!answer.trim()) return fallback;
  return /^y/i.test(answer.trim());
}
