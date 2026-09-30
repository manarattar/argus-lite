import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { analyzeStream } from './api'

const EXAMPLES = [
  {
    key: 'warranty',
    label: 'Phone warranty',
    blurb: 'Everyday example',
    question: 'Does the warranty cover water damage?',
    document: `NovaPhone X12 - Limited Warranty Terms

Thank you for purchasing the NovaPhone X12. This warranty covers your device
for 24 months from the original purchase date.

What is covered:
This warranty covers manufacturing defects in materials and workmanship,
including battery capacity dropping below 80% within the first 12 months,
screen defects present at the time of purchase, and malfunction of the
camera, speaker, or charging port under normal use.

What is not covered:
This warranty does not cover damage caused by drops, impacts, or accidents.
It does not cover water or liquid damage of any kind, including exposure to
rain, spills, or submersion, even though the device is marketed as
"splash-resistant." It does not cover damage from unauthorized repairs or
modifications, cosmetic wear such as scratches, or loss and theft of the
device.

Battery replacement:
If your battery capacity drops below 80% of its original capacity within
the first 12 months of ownership, we will replace the battery free of
charge. After 12 months, battery replacement is available for a service
fee of 49 euros.

Screen repairs:
Cracked or shattered screens are considered accidental damage and are not
covered under this warranty. Screen repair services are available separately
for a fee starting at 129 euros, depending on the extent of the damage.

How to make a claim:
To make a warranty claim, contact customer support with your proof of
purchase and a description of the issue. Devices will be inspected before
any repair or replacement is approved. Claims found to involve excluded
damage (such as liquid exposure or drops) will be denied, and a repair
quote will be offered instead.`,
  },
  {
    key: 'kyc',
    label: 'Bank KYC review',
    blurb: 'Customer onboarding',
    question: 'Does this declaration identify all ultimate beneficial owners with more than 25% ownership?',
    document: `Beneficial Ownership Declaration - Meridian Trading Ltd

This declaration is submitted in accordance with anti-money laundering
requirements to identify the ultimate beneficial owners (UBOs) of Meridian
Trading Ltd, a company registered in Malta.

Declared ownership structure:

Mr. Andres Kovac holds 30% of the shares in Meridian Trading Ltd directly,
in his own name.

Ms. Elena Brandt holds 25% of the shares in Meridian Trading Ltd directly,
in her own name.

The remaining 45% of shares are held by Silverline Holdings Ltd, a company
registered in the British Virgin Islands. Silverline Holdings Ltd is a
corporate shareholder; its own ownership structure and ultimate beneficial
owners are not disclosed in this declaration.

Meridian Trading Ltd confirms that Mr. Kovac and Ms. Brandt are not
politically exposed persons and have no adverse media findings associated
with their names as of the date of this declaration.

No further natural persons are named as having control over Meridian
Trading Ltd beyond those listed above.`,
  },
  {
    key: 'loan',
    label: 'Loan underwriting',
    blurb: 'Income verification',
    question: 'The applicant states an annual income of €54,000 and permanent employment — does this payslip support that?',
    document: `Employment and Income Verification - Horizon Logistics BV

Employee name: J. de Vries
Position: Warehouse Supervisor
Employment type: Fixed-term contract, valid until 31 December 2026
Start date: 1 March 2024

Gross monthly salary: EUR 3,450
Payment frequency: Monthly, paid on the last working day of the month

This letter confirms that J. de Vries is currently employed by Horizon
Logistics BV under the terms stated above. No additional bonus, commission,
or variable compensation is included in this employee's compensation
package.

This document is issued for the purpose of income verification and is
valid for 90 days from the date of issue.`,
  },
]

const STRENGTH_STYLES = {
  strong: 'bg-emerald-100 text-emerald-700',
  moderate: 'bg-amber-100 text-amber-700',
  weak: 'bg-orange-100 text-orange-700',
  insufficient: 'bg-red-100 text-red-700',
}

const STRENGTH_EXPLAIN = {
  strong: 'nearly all the evidence checked out against the source',
  moderate: 'most of the evidence checked out, a little was loose',
  weak: 'only a minority of the evidence actually held up',
  insufficient: 'little or nothing here was verifiably grounded',
}

const KIND_LABEL = {
  ai: 'AI call · LLM',
  jev: 'AI decision · Jev',
  code: 'Plain code, no AI',
}

const KIND_ICON_BG = {
  ai: 'bg-teal-100',
  jev: 'bg-indigo-100',
  code: 'bg-slate-100',
}

// ---- one row in the "AI step" timeline -----------------------------------

function StepRow({ icon, kind, title, active, done, children }) {
  return (
    <div className={`rounded-xl border p-4 transition-all ${
      active ? 'border-teal-300 bg-teal-50/60 shadow-sm' : 'border-slate-200 bg-white'
    } ${!active && !done ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base ${
          KIND_ICON_BG[kind]
        }`}>
          {icon}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {KIND_LABEL[kind]}
          </p>
        </div>
        {active && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-teal-500" />
        )}
        {done && !active && <span className="text-emerald-600">✓</span>}
      </div>
      {children && <div className="mt-3 pl-11">{children}</div>}
    </div>
  )
}

function QuoteBubble({ item }) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
      {item.status === 'pending' && (
        <span className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-teal-500" />
      )}
      {item.status === 'grounded' && <span className="shrink-0 text-emerald-600">✓</span>}
      {item.status === 'not_grounded' && <span className="shrink-0 text-red-600">✗</span>}
      <span className="text-slate-600">&ldquo;{item.quote}&rdquo;</span>
    </div>
  )
}

function RatingBars({ name, rating }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold capitalize text-slate-700">{name}</span>
        <span className="text-slate-400">
          weighted {rating.value}/5 · confidence {Math.round(rating.confidence * 100)}%
        </span>
      </div>
      <div className="space-y-1">
        {Object.entries(rating.probabilities).map(([level, p]) => (
          <div key={level} className="flex items-center gap-2 text-[11px]">
            <span className="w-3 text-right font-mono text-slate-400">{level}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${p * 100}%` }} />
            </div>
            <span className="w-9 text-right font-mono text-slate-500">{Math.round(p * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function JevJudgment({ judge, summary }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RatingBars name="severity" rating={judge.severity} />
        <RatingBars name="likelihood" rating={judge.likelihood} />
      </div>
      {judge.uncertain && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          Low confidence: the probability is spread over several levels, so a person should check this rating.
        </p>
      )}
      <p className="text-sm text-slate-600">{summary}</p>
      <p className="text-[11px] text-slate-400">
        Jev returns a probability for every level instead of writing an answer, so you can see how
        sure it is. Decided in {judge.latency_ms} ms by {judge.model}.
      </p>
    </div>
  )
}

function ScoreExplained({ score }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-slate-700">severity {score.severity}</span>
        <span className="text-slate-400">×</span>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-slate-700">likelihood {score.likelihood}</span>
        <span className="text-slate-400">×</span>
        <span className={`rounded-md px-2.5 py-1 font-mono ${STRENGTH_STYLES[score.evidence_strength]}`}>
          {score.evidence_strength} evidence ({score.discount_applied})
        </span>
        <span className="text-slate-400">=</span>
        <span className="rounded-md bg-teal-700 px-3 py-1 font-mono font-semibold text-white">
          {score.final_score} / 25
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 text-[12px] text-slate-500 sm:grid-cols-3">
        <div>
          <p className="font-semibold text-slate-700">Severity — {score.severity}/5</p>
          <p>How bad this would be if it&rsquo;s true. The AI rates this on a 1&ndash;5 scale; it never invents the final label.</p>
        </div>
        <div>
          <p className="font-semibold text-slate-700">Likelihood — {score.likelihood}/5</p>
          <p>How strongly the verified evidence actually points to it being true.</p>
        </div>
        <div>
          <p className="font-semibold text-slate-700">Evidence strength — {score.evidence_strength}</p>
          <p>{STRENGTH_EXPLAIN[score.evidence_strength]}, so the score is multiplied by {score.discount_applied}.</p>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        Formula: severity × likelihood × evidence-strength discount, out of a maximum of 25.
        A severe-sounding claim backed by weak or invented evidence is mathematically capped low —
        that&rsquo;s the actual anti-hallucination mechanism, not a disclaimer bolted on afterward.
      </p>
    </div>
  )
}

// ---- main app --------------------------------------------------------------

export default function App() {
  const [file, setFile] = useState(null)
  const [documentText, setDocumentText] = useState('')
  const [question, setQuestion] = useState(EXAMPLES[0].question)
  const [activeExample, setActiveExample] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  const [phase, setPhase] = useState(null) // searching | checking | assessing | scoring | done
  const [quotes, setQuotes] = useState([])
  const [summary, setSummary] = useState(null)
  const [judge, setJudge] = useState(null) // 'jev' | 'llm'
  const [judgeDetail, setJudgeDetail] = useState(null)
  const [score, setScore] = useState(null)

  const onDrop = useCallback((accepted) => {
    if (accepted[0]) {
      setFile(accepted[0])
      setDocumentText('')
      setActiveExample(null)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
    },
  })

  const loadExample = (example) => {
    setFile(null)
    setDocumentText(example.document)
    setQuestion(example.question)
    setActiveExample(example.key)
  }

  const reset = () => {
    setPhase(null)
    setQuotes([])
    setSummary(null)
    setJudge(null)
    setJudgeDetail(null)
    setScore(null)
    setError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    reset()
    setRunning(true)
    try {
      await analyzeStream({ file, documentText, question }, (event) => {
        switch (event.step) {
          case 'searching':
            setPhase('searching')
            break
          case 'found_quotes':
            setPhase('checking')
            setQuotes(event.quotes.map((q) => ({ quote: q, status: 'pending' })))
            break
          case 'checked_quote':
            setQuotes((prev) =>
              prev.map((q) =>
                q.quote === event.result.quote
                  ? { ...q, status: event.result.grounded ? 'grounded' : 'not_grounded', match_score: event.result.match_score }
                  : q,
              ),
            )
            break
          case 'assessing':
            setPhase('assessing')
            setJudge(event.judge)
            break
          case 'assessed':
            setSummary(event.summary)
            setJudgeDetail(event.judge)
            break
          case 'scoring':
            setPhase('scoring')
            break
          case 'done':
            setPhase('done')
            setScore(event.score)
            break
          default:
            break
        }
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const hasInput = file || documentText.trim()
  const phaseIndex = { searching: 0, checking: 1, assessing: 2, scoring: 3, done: 4 }
  const currentIndex = phase ? phaseIndex[phase] : -1

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <h1 className="text-xl font-semibold text-slate-900">ARGUS-Lite</h1>
          <p className="mt-1 text-sm text-slate-500">
            Watch an AI agent find evidence in a document, verify it&rsquo;s real, and
            compute a score by formula — not by just asking it for an answer. An LLM finds
            the quotes; Jev, a decision model, rates them with a probability for every level.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium text-slate-700">Try an example</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.key}
                type="button"
                onClick={() => loadExample(ex)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  activeExample === ex.key
                    ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-400'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <p className="text-sm font-semibold text-slate-800">{ex.label}</p>
                <p className="text-xs text-slate-400">{ex.blurb}</p>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Document (or pick an example above)
            </label>

            <div
              {...getRootProps()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-5 text-center text-sm transition-colors ${
                isDragActive ? 'border-teal-400 bg-teal-50' : 'border-slate-300 bg-white hover:border-slate-400'
              }`}
            >
              <input {...getInputProps()} />
              {file ? (
                <p className="text-slate-700">📄 {file.name} <span className="text-slate-400">(click or drop to replace)</span></p>
              ) : (
                <p className="text-slate-500">Drop a PDF, DOCX, or TXT file here, or click to choose one</p>
              )}
            </div>

            <div className="mt-2 text-center text-xs text-slate-400">— or —</div>
            <textarea
              value={documentText}
              onChange={(e) => {
                setDocumentText(e.target.value)
                setActiveExample(null)
                if (e.target.value) setFile(null)
              }}
              rows={6}
              placeholder="...paste document text directly here"
              className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              What do you want to check?
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Does the warranty cover water damage?"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <button
            type="submit"
            disabled={running || !hasInput || !question.trim()}
            className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Working...' : 'Analyze'}
          </button>
        </form>

        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {phase && (
          <div className="mt-8 space-y-3">
            <StepRow
              icon="🔎"
              kind="ai"
              title="Agent searches the document for evidence"
              active={phase === 'searching'}
              done={currentIndex > 0}
            >
              {quotes.length === 0 && phase === 'searching' && (
                <p className="text-xs text-slate-400">Reading the document...</p>
              )}
            </StepRow>

            <StepRow
              icon="⚙️"
              kind="code"
              title="Code checks each quote is real, not invented"
              active={phase === 'checking'}
              done={currentIndex > 1}
            >
              {quotes.length > 0 && quotes.map((q, i) => <QuoteBubble key={i} item={q} />)}
            </StepRow>

            <StepRow
              icon="🧠"
              kind={judge === 'llm' ? 'ai' : 'jev'}
              title={
                judge === 'llm'
                  ? 'Agent judges severity & likelihood from verified evidence only'
                  : 'Jev rates severity & likelihood from verified evidence only'
              }
              active={phase === 'assessing'}
              done={currentIndex > 2}
            >
              {judgeDetail ? (
                <JevJudgment judge={judgeDetail} summary={summary} />
              ) : (
                summary && <p className="text-sm text-slate-600">{summary}</p>
              )}
            </StepRow>

            <StepRow
              icon="🧮"
              kind="code"
              title="Code computes the final score — the agent never states it directly"
              active={phase === 'scoring'}
              done={phase === 'done'}
            >
              {score && <ScoreExplained score={score} />}
            </StepRow>
          </div>
        )}
      </main>
    </div>
  )
}
