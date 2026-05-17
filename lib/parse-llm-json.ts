import { jsonrepair } from "jsonrepair";

// Parse pipeline (each step only runs if the previous one failed):
//  1) strip code-fence markers and any leading non-JSON prose; try parse.
//  2) light hand-rolled cleanup (smart quotes, trailing commas, control chars); try parse.
//  3) jsonrepair — handles bracket-type swaps, missing closers, unescaped quotes,
//     single-quoted strings, comments, unquoted keys, and most other LLM JSON quirks.
//  4) hand-rolled inner-quote escaper as a last resort.
//  5) truncated-array recovery — finds the last fully-closed object and seals the array.
export function tryParseJson(raw: string): unknown {
  let s = raw.replace(/```json\s*|\s*```/g, "").trim();
  const objStart = s.indexOf("{");
  const arrStart = s.indexOf("[");
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    s = s.slice(arrStart);
  } else if (objStart !== -1) {
    s = s.slice(objStart);
  }

  try {
    return JSON.parse(s);
  } catch {}

  const repaired = s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/[\u0000-\u0008\u000B-\u001F]/g, " ");

  try {
    return JSON.parse(repaired);
  } catch {}

  try {
    return JSON.parse(jsonrepair(repaired));
  } catch {}

  try {
    return JSON.parse(escapeInnerQuotes(repaired));
  } catch {}

  const truncated = repairTruncatedArray(repaired);
  if (truncated) {
    try {
      return JSON.parse(truncated);
    } catch {}
    try {
      return JSON.parse(jsonrepair(truncated));
    } catch {}
    try {
      return JSON.parse(escapeInnerQuotes(truncated));
    } catch {}
  }

  try {
    return JSON.parse(jsonrepair(s));
  } catch (e) {
    const err = e as Error;
    const pos = (err.message.match(/position (\d+)/) || [])[1];
    const snippet = pos
      ? repaired.slice(Math.max(0, +pos - 60), +pos + 60)
      : repaired.slice(0, 300);
    throw new Error(`JSON parse failed: ${err.message}\n...${snippet}...`);
  }
}

function repairTruncatedArray(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith("[")) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let lastTopLevelClose = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (c === "}" && depth === 1) {
        lastTopLevelClose = i;
      }
      if (depth === 0 && c === "]") {
        return trimmed.slice(0, i + 1);
      }
    }
  }

  if (lastTopLevelClose > 0) {
    return trimmed.slice(0, lastTopLevelClose + 1) + "]";
  }
  return null;
}

function escapeInnerQuotes(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      if (!inString) {
        inString = true;
        out += c;
        continue;
      }
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const next = s[j] as string | undefined;
      if (
        next === "," ||
        next === "}" ||
        next === "]" ||
        next === ":" ||
        next === undefined
      ) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}
