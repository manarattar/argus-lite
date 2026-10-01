import { useCallback, useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { analyzeStream } from './api'
import { EXAMPLES } from './examples'
import Onboarding, { hasSeenTour } from './components/Onboarding'
import ThemeToggle from "./components/ThemeToggle.jsx";

const LANDING_TOUR = 'proofline.onboarded.v1'
const RESULTS_TOUR = 'proofline.results-tour.v1'

const LANDING_STEPS = [
  {
    target: null,
    title: 'Welcome to Proofline',
    body: (
      <>
        <p>
          Give it a document and a question. It finds the evidence, checks the quotes are real, and
          then works the score out with a formula, so a made-up quote can’t push the score up.
        </p>
        <p style={{ marginTop: 8 }}>
          Each step is marked by who does it: an LLM, Jev (a decision model) or plain code.
        </p>
      </>
    ),
  },
  {
    target: 'examples',
    title: 'Start from an example',
    body: 'Three real-looking documents: a phone warranty, a bank onboarding declaration and a payslip. Picking one fills in the document and the question.',
  },
  {
    target: 'input',
    title: 'Or bring your own',
    body: 'Drop a PDF, DOCX or TXT file, or paste text, then ask what you want to check. Questions with a clear yes/no answer in the text work best.',
  },
  {
    target: 'analyze',
    title: 'Press Analyze',
    body: 'The trail fills in live as it works, one step at a time. It takes about half a minute.',
  },
  {
    target: 'trail',
    title: 'The trail',
    body: 'Four steps, top to bottom: the LLM finds quotes, code checks them, Jev rates severity and likelihood, code computes the score.',
  },
]

const RESULT_STEPS = [
  {
    target: 'step-check',
    title: 'Highlighted means verified',
    body: 'Plain code searched the document for each quote. Yellow ones were found word for word. Struck-through ones weren’t there and are thrown out.',
  },
  {
    target: 'step-judge',
    title: 'Jev shows how sure it is',
    body: 'Jev doesn’t write an answer. It gives a probability for each level from 1 to 5, so a rating spread over several levels is visibly a shaky one.',
  },
  {
    target: 'step-score',
    title: 'The score is a formula',
    body: 'Severity × likelihood × an evidence discount, out of 25. Weak or invented evidence shrinks the score, whatever the model says.',
  },
]

const STRENGTH_TONE = {
  strong: 'bg-ok-soft text-ok',
  moderate: 'bg-warn-soft text-warn',
  weak: 'bg-warn-soft text-warn',
  insufficient: 'bg-bad-soft text-bad',
}

const STRENGTH_EXPLAIN = {
  strong: 'nearly all the evidence checked out against the source',
  moderate: 'most of the evidence checked out, a little was loose',
  weak: 'only a minority of the evidence actually held up',
  insufficient: 'little or nothing here was verifiably grounded',
}

const KIND = {
  ai: { label: 'LLM', cls: 'border-llm text-llm' },
  jev: { label: 'Jev', cls: 'border-jev text-jev' },
  code: { label: 'Code', cls: 'border-code text-code' },
}

// ---- one step of the trail ---------------------------------------------------

function Step({ n, kind, title, active, done, tour, children }) {
  const k = KIND[kind]
  return (
    <section
      data-tour={tour}
      className={`grid grid-cols-[28px_1fr] gap-x-3 rounded-[6px] border bg-sheet p-4 transition-opacity sm:p-5 ${
        active ? 'border-ink' : 'border-rule'
      } ${!active && !done ? 'opacity-60' : ''}`}
    >
      <span
        className={`num flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold ${
          done && !active ? 'bg-ink text-sheet' : 'border border-ink-3 text-ink-2'
        }`}
        aria-hidden
      >
        {done && !active ? '✓' : n}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-[15.5px] font-bold leading-snug text-ink">{title}</h3>
          <span className={`num rounded-[3px] border px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wider ${k.cls}`}>
            {k.label}
          </span>
          {active && <span className="h-2 w-2 animate-pulse rounded-full bg-ink" aria-label="working" />}
        </div>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </section>
  )
}

function Quote({ item }) {
  const pending = item.status === 'pending'
  const bad = item.status === 'not_grounded'
  return (
    <li className="grid grid-cols-[1fr] gap-1 border-t border-rule py-2.5 first:border-t-0 first:pt-0">
      <p className={`text-[14.5px] leading-[1.7] ${bad ? 'text-ink-3 line-through decoration-bad decoration-2' : 'text-ink'}`}>
        {pending ? (
          <span>&ldquo;{item.quote}&rdquo;</span>
        ) : bad ? (
          <span>&ldquo;{item.quote}&rdquo;</span>
        ) : (
          <span className="hi">&ldquo;{item.quote}&rdquo;</span>
        )}
      </p>
      <p className={`num text-[11px] ${bad ? 'text-bad' : pending ? 'text-ink-3' : 'text-ok'}`}>
        {pending ? 'checking against the document…' : bad ? 'not in the document, thrown out' : 'found in the document'}
      </p>
    </li>
  )
}

function RatingBars({ name, rating }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-bold capitalize text-ink">{name}</span>
        <span className="num text-[11px] text-ink-3">
          {rating.value}/5 · {Math.round(rating.confidence * 100)}% sure
        </span>
      </div>
      <div className="space-y-1">
        {Object.entries(rating.probabilities).map(([level, p]) => (
          <div key={level} className="grid grid-cols-[14px_1fr_36px] items-center gap-2 text-[11px]">
            <span className="num text-right text-ink-3">{level}</span>
            <div className="h-2 overflow-hidden rounded-full bg-code-soft">
              <div className="h-full rounded-full bg-jev" style={{ width: `${p * 100}%` }} />
            </div>
            <span className="num text-right text-ink-2">{Math.round(p * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function JevJudgment({ judge, summary }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <RatingBars name="severity" rating={judge.severity} />
        <RatingBars name="likelihood" rating={judge.likelihood} />
      </div>
      {judge.uncertain && (
        <p className="rounded-[4px] bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Low confidence: the probability is spread over several levels, so a person should check this rating.
        </p>
      )}
      <p className="text-[14.5px] leading-relaxed text-ink-2">{summary}</p>
      <p className="text-[12px] leading-relaxed text-ink-3">
        Jev returns a probability for every level instead of writing an answer. Decided in{' '}
        <span className="num">{judge.latency_ms} ms</span> by <span className="num">{judge.model}</span>.
      </p>
    </div>
  )
}

function Term({ children, tone = 'bg-code-soft text-ink' }) {
  return <span className={`num rounded-[4px] px-2.5 py-1 text-[13px] ${tone}`}>{children}</span>
}

function ScoreExplained({ score }) {
  const share = Math.min(100, (score.final_score / 25) * 100)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Term>severity {score.severity}</Term>
        <span className="text-ink-3">×</span>
        <Term>likelihood {score.likelihood}</Term>
        <span className="text-ink-3">×</span>
        <Term tone={STRENGTH_TONE[score.evidence_strength]}>
          {score.evidence_strength} evidence ({score.discount_applied})
        </Term>
        <span className="text-ink-3">=</span>
      </div>

      <div>
        <p className="num flex items-baseline gap-2">
          <span className="text-[40px] font-bold leading-none text-ink">{score.final_score}</span>
          <span className="text-[14px] text-ink-3">/ 25</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-code-soft" role="img" aria-label={`${score.final_score} out of 25`}>
          <div className="h-full rounded-full bg-ink" style={{ width: `${share}%` }} />
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 border-t border-rule pt-4 text-[13px] leading-snug text-ink-2 sm:grid-cols-3">
        <div>
          <dt className="font-bold text-ink">Severity, {score.severity} of 5</dt>
          <dd className="mt-0.5">How bad this would be if it’s true. Rated on a 1 to 5 scale; the model never invents the final label.</dd>
        </div>
        <div>
          <dt className="font-bold text-ink">Likelihood, {score.likelihood} of 5</dt>
          <dd className="mt-0.5">How strongly the verified evidence points to it being true.</dd>
        </div>
        <div>
          <dt className="font-bold text-ink">Evidence, {score.evidence_strength}</dt>
          <dd className="mt-0.5">{STRENGTH_EXPLAIN[score.evidence_strength]}, so the score is multiplied by {score.discount_applied}.</dd>
        </div>
      </dl>

      <p className="text-[12px] leading-relaxed text-ink-3">
        A severe-sounding claim backed by weak or invented evidence is capped low by the formula. That
        is the anti-hallucination mechanism itself, not a disclaimer added afterwards.
      </p>
    </div>
  )
}

// ---- main app ------------------------------------------------------------------

export default function App() {
  const first = EXAMPLES[0]
  const [file, setFile] = useState(null)
  const [documentText, setDocumentText] = useState(first.document)
  const [question, setQuestion] = useState(first.question)
  const [activeExample, setActiveExample] = useState(first.key)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  const [phase, setPhase] = useState(null) // searching | checking | assessing | scoring | done
  const [quotes, setQuotes] = useState([])
  const [summary, setSummary] = useState(null)
  const [judge, setJudge] = useState(null) // 'jev' | 'llm'
  const [judgeDetail, setJudgeDetail] = useState(null)
  const [score, setScore] = useState(null)

  const [tour, setTour] = useState(() => (hasSeenTour(LANDING_TOUR) ? null : 'landing'))
  const trailRef = useRef(null)

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

  const start = async (input) => {
    reset()
    setRunning(true)
    // on a phone the trail is below the form: bring it into view
    if (window.innerWidth < 1024) setTimeout(() => trailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    try {
      await analyzeStream(input, (event) => {
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

  const handleSubmit = (e) => {
    e.preventDefault()
    start({ file, documentText, question })
  }

  // after the first finished run, point out how to read it
  useEffect(() => {
    if (phase === 'done' && !tour && !hasSeenTour(RESULTS_TOUR)) setTour('results')
  }, [phase, tour])

  const closeTour = (finished) => {
    const was = tour
    setTour(null)
    if (was === 'landing' && finished && !running) {
      loadExample(first)
      start({ file: null, documentText: first.document, question: first.question })
    }
  }

  const hasInput = file || documentText.trim()
  const phaseIndex = { searching: 0, checking: 1, assessing: 2, scoring: 3, done: 4 }
  const currentIndex = phase ? phaseIndex[phase] : -1
  const field =
    'w-full rounded-[4px] border border-rule bg-sheet px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none'

  return (
    <div className="min-h-screen bg-desk">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <h1 className="text-[20px] font-bold leading-none text-ink">Proofline</h1>
            <p className="mt-1.5 hidden max-w-[62ch] text-[14px] leading-snug text-ink-2 sm:block">
              An AI agent finds evidence in a document, code checks it is real, and a formula, not the
              model, produces the score.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setTour('landing')}
            className="shrink-0 rounded-[4px] border border-rule px-3 py-1.5 text-[13px] font-bold text-ink hover:border-ink-3"
          >
            How it works
          </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <form onSubmit={handleSubmit} className="space-y-5 lg:sticky lg:top-6">
          <section data-tour="examples">
            <p className="label mb-2">Start from an example</p>
            <div className="grid grid-cols-1 gap-2">
              {EXAMPLES.map((ex) => {
                const on = activeExample === ex.key
                return (
                  <button
                    key={ex.key}
                    type="button"
                    onClick={() => loadExample(ex)}
                    aria-pressed={on}
                    className={`flex items-baseline justify-between gap-3 rounded-[4px] border px-3 py-2.5 text-left ${
                      on ? 'border-ink bg-sheet' : 'border-rule bg-sheet hover:border-ink-3'
                    }`}
                  >
                    <span className="text-[14.5px] font-bold text-ink">
                      {on && <span className="hi mr-1.5 !px-1 text-[11px]">open</span>}
                      {ex.label}
                    </span>
                    <span className="text-[12.5px] text-ink-3">{ex.blurb}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section data-tour="input" className="space-y-3">
            <div>
              <label htmlFor="doc" className="label mb-2 block">Document</label>
              <div
                {...getRootProps()}
                className={`cursor-pointer rounded-[4px] border border-dashed px-4 py-3 text-center text-[13.5px] ${
                  isDragActive ? 'border-ink bg-code-soft' : 'border-ink-3 bg-sheet hover:border-ink'
                }`}
              >
                <input {...getInputProps()} />
                {file ? (
                  <p className="text-ink">
                    {file.name} <span className="text-ink-3">(click or drop to replace)</span>
                  </p>
                ) : (
                  <p className="text-ink-2">Drop a PDF, DOCX or TXT here, or click to choose</p>
                )}
              </div>
              <textarea
                id="doc"
                value={documentText}
                onChange={(e) => {
                  setDocumentText(e.target.value)
                  setActiveExample(null)
                  if (e.target.value) setFile(null)
                }}
                rows={7}
                placeholder="…or paste the document text here"
                className={`${field} mt-2 resize-y font-mono text-[12.5px] leading-relaxed`}
              />
            </div>

            <div>
              <label htmlFor="q" className="label mb-2 block">What do you want to check?</label>
              <input
                id="q"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Does the warranty cover water damage?"
                className={field}
              />
            </div>
          </section>

          <button
            data-tour="analyze"
            type="submit"
            disabled={running || !hasInput || !question.trim()}
            className="w-full rounded-[4px] bg-ink px-5 py-3 text-[15px] font-bold text-sheet hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'Working…' : 'Analyze'}
          </button>
        </form>

        <div ref={trailRef} data-tour="trail" className="min-w-0 scroll-mt-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="label">The trail</h2>
            {!phase && <span className="text-[12.5px] text-ink-3">Fills in when you press Analyze</span>}
          </div>

          {error && (
            <div role="alert" className="rounded-[6px] border border-bad bg-bad-soft px-4 py-3 text-[14px] text-bad">
              {error}
            </div>
          )}

          <Step n={1} kind="ai" tour="step-find" title="Agent searches the document for evidence" active={phase === 'searching'} done={currentIndex > 0}>
            {!phase ? (
              <p className="text-[13.5px] leading-relaxed text-ink-3">
                An LLM reads the document and copies out the passages that bear on your question.
              </p>
            ) : (
              quotes.length === 0 && phase === 'searching' && <p className="text-[13.5px] text-ink-3">Reading the document…</p>
            )}
          </Step>

          <Step n={2} kind="code" tour="step-check" title="Code checks each quote is real, not invented" active={phase === 'checking'} done={currentIndex > 1}>
            {quotes.length > 0 ? (
              <ul>{quotes.map((q, i) => <Quote key={i} item={q} />)}</ul>
            ) : (
              !phase && (
                <p className="text-[13.5px] leading-relaxed text-ink-3">
                  Plain code looks for each quote in the source text. A quote that isn’t there is thrown out.
                </p>
              )
            )}
          </Step>

          <Step
            n={3}
            kind={judge === 'llm' ? 'ai' : 'jev'}
            tour="step-judge"
            title={judge === 'llm' ? 'Agent judges severity and likelihood from verified evidence only' : 'Jev rates severity and likelihood from verified evidence only'}
            active={phase === 'assessing'}
            done={currentIndex > 2}
          >
            {judgeDetail ? (
              <JevJudgment judge={judgeDetail} summary={summary} />
            ) : summary ? (
              <p className="text-[14.5px] leading-relaxed text-ink-2">{summary}</p>
            ) : (
              !phase && (
                <p className="text-[13.5px] leading-relaxed text-ink-3">
                  A decision model rates how bad it would be and how likely it is, from the verified quotes only.
                </p>
              )
            )}
          </Step>

          <Step n={4} kind="code" tour="step-score" title="Code computes the final score, the agent never states it" active={phase === 'scoring'} done={phase === 'done'}>
            {score ? (
              <ScoreExplained score={score} />
            ) : (
              !phase && (
                <p className="text-[13.5px] leading-relaxed text-ink-3">
                  severity × likelihood × an evidence discount, out of 25.
                </p>
              )
            )}
          </Step>
        </div>
      </main>

      {tour === 'landing' && (
        <Onboarding steps={LANDING_STEPS} storageKey={LANDING_TOUR} finishLabel="Run the warranty example" onClose={closeTour} />
      )}
      {tour === 'results' && <Onboarding steps={RESULT_STEPS} storageKey={RESULTS_TOUR} onClose={closeTour} />}
    </div>
  )
}
