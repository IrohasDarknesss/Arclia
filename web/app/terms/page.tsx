import React from "react";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-slate-900">
        利用規約・ライセンス・免責事項
      </h1>

      <section className="space-y-2 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-bold text-slate-900">
          1. arXivに関する表示（ARC009）
        </h2>
        <p>
          Thank you to arXiv for use of its open access interoperability. This
          service is not affiliated with, endorsed by, or sponsored by arXiv or
          Cornell University.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-bold text-slate-900">
          2. 論文ライセンスと本文解析の範囲（ARC005）
        </h2>
        <p>
          本サービスでは、arXivが提供するメタデータ（原題・著者・Abstract等）をもとに日本語の構造化要約を生成します。本文PDFを用いた詳細解説（10分解説・主要数式解説）は、元論文のライセンスが改変・再配布を明示的に許諾しているもの（CC
          BY 4.0、CC BY-SA 4.0、CC0 1.0）に限って提供します。
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed text-slate-700">
        <h2 className="text-base font-bold text-slate-900">
          3. AI生成要約に関する免責事項
        </h2>
        <p>
          本サービスの日本語要約・AI質問応答・論文比較はLLMにより自動生成され、自動検証を経たものを表示していますが、完全な正確性を保証するものではありません。重要な数値や結論を引用・利用される際は、必ず各主張に付与された根拠リンクからarXivの原文またはPDFをご確認ください。
        </p>
      </section>
    </div>
  );
}
