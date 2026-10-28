import React from "react";
import {
  parseMathSegments,
  renderBlockLatexHtml,
} from "@/lib/paperDetail/mathText";

export function MathText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const segments = parseMathSegments(text);

  return (
    <span className={className}>
      {segments.map((seg, idx) => {
        if (seg.type === "text" || !seg.html) {
          return <React.Fragment key={idx}>{seg.raw}</React.Fragment>;
        }
        return (
          <span
            key={idx}
            className={seg.type === "math-block" ? "my-2 block overflow-x-auto" : "inline"}
            dangerouslySetInnerHTML={{ __html: seg.html }}
          />
        );
      })}
    </span>
  );
}

export function BlockLatex({ latex }: { latex: string }) {
  const { html, fallbackRaw } = renderBlockLatexHtml(latex);
  if (!html) {
    return (
      <pre className="overflow-x-auto rounded bg-slate-100 p-3 font-mono text-xs text-slate-800">
        <code>{fallbackRaw}</code>
      </pre>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded bg-slate-50 px-4 py-3 text-slate-900"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
