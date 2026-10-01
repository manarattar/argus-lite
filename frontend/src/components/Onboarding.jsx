import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

/*
 * A short guided tour. Each step points at an element marked data-tour="...";
 * steps whose element isn't on the page are skipped. Styled only through the
 * --tour-* CSS variables (set in index.css), so it doesn't depend on the
 * app's CSS framework. onStep(target) lets the app bring a hidden panel into
 * view (phones show one panel at a time).
 */

export function hasSeenTour(key) {
  try {
    return localStorage.getItem(key) === 'yes'
  } catch {
    return false
  }
}

function markSeen(key) {
  try {
    localStorage.setItem(key, 'yes')
  } catch {
    /* storage blocked: the tour simply shows again next time */
  }
}

const findTarget = (target) => target && document.querySelector(`[data-tour="${target}"]`)

function useTargetRect(target) {
  const [rect, setRect] = useState(null)
  const measure = useCallback(() => {
    const el = findTarget(target)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [target])

  // bring the target on screen, then measure where it ended up
  useLayoutEffect(() => {
    const el = findTarget(target)
    if (el) {
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6
      el.scrollIntoView({ block: tall ? 'start' : 'center' })
    }
    measure()
    // the app may have just switched a panel in: look again once it has rendered
    const again = setTimeout(() => {
      const late = findTarget(target)
      if (late) late.scrollIntoView({ block: late.getBoundingClientRect().height > window.innerHeight * 0.6 ? 'start' : 'center' })
      measure()
    }, 120)
    return () => clearTimeout(again)
  }, [target, measure])

  useEffect(() => {
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])
  return rect
}

const CARD_W = 360

/** Put the card beside the highlighted area on whichever side has room; on phones, along the bottom. */
function cardPosition(rect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 14
  if (vw < 640) return { left: 12, right: 12, bottom: 12 }
  if (!rect) return { left: Math.max(16, (vw - 440) / 2), top: Math.max(16, vh * 0.16), width: 440 }
  const top = Math.min(Math.max(16, rect.top + 16), vh - 280)
  if (rect.right + gap + CARD_W < vw - 16) return { left: rect.right + gap, top, width: CARD_W }
  if (rect.left - gap - CARD_W > 16) return { left: rect.left - gap - CARD_W, top, width: CARD_W }
  const left = Math.min(Math.max(16, rect.left), vw - CARD_W - 16)
  if (rect.bottom + gap + 240 < vh) return { left, top: rect.bottom + gap, width: CARD_W }
  if (rect.top - gap - 240 > 0) return { left, bottom: vh - rect.top + gap, width: CARD_W }
  return { left, bottom: 16, width: CARD_W }
}

const btn = {
  base: { font: 'inherit', fontSize: 13, borderRadius: 'var(--tour-radius, 3px)', padding: '7px 14px', cursor: 'pointer' },
  primary: { background: 'var(--tour-accent, var(--tour-ink))', color: 'var(--tour-on-accent, var(--tour-surface))', border: '1px solid var(--tour-accent, var(--tour-ink))', fontWeight: 600 },
  secondary: { background: 'transparent', color: 'var(--tour-ink)', border: '1px solid var(--tour-rule)' },
  quiet: { background: 'transparent', color: 'var(--tour-muted)', border: 'none', padding: '6px 0', marginRight: 'auto' },
}

export default function Onboarding({ steps, storageKey, finishLabel = 'Done', onClose, onStep }) {
  // only the steps whose target is on the page, checked once the page has rendered
  const [visible, setVisible] = useState([])
  useLayoutEffect(() => {
    setVisible(steps.filter((s) => !s.target || s.always || findTarget(s.target)))
  }, [steps])
  const [index, setIndex] = useState(0)
  const step = visible[index]
  const rect = useTargetRect(step?.target)
  const last = index === visible.length - 1

  useEffect(() => {
    if (step) onStep?.(step.target)
  }, [step, onStep])

  const close = useCallback((finished = false) => {
    markSeen(storageKey)
    onClose(finished)
  }, [onClose, storageKey])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight' && !last) setIndex((i) => i + 1)
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, last])

  if (!step) return null
  const pos = cardPosition(rect)
  const pad = 6

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        // the highlight: a transparent box whose huge shadow dims everything else
        <div
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: 'var(--tour-radius, 4px)',
            boxShadow: '0 0 0 2px var(--tour-ink), 0 0 0 9999px var(--tour-scrim)',
            transition: 'all 250ms ease',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--tour-scrim)' }} />
      )}

      <div
        style={{
          position: 'fixed',
          ...pos,
          maxHeight: 'calc(100dvh - 24px)',
          overflowY: 'auto',
          background: 'var(--tour-surface)',
          color: 'var(--tour-ink)',
          border: '1px solid var(--tour-rule)',
          borderRadius: 'var(--tour-radius, 4px)',
          padding: 20,
          boxShadow: '0 18px 50px rgba(10, 14, 20, 0.28)',
          fontFamily: 'var(--tour-font, inherit)',
        }}
      >
        <p style={{ margin: 0, fontSize: 12, color: 'var(--tour-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {index + 1} of {visible.length}
        </p>
        <h2 id="tour-title" style={{ margin: '4px 0 0', fontSize: 18, lineHeight: 1.3, fontWeight: 600, fontFamily: 'var(--tour-heading-font, inherit)' }}>
          {step.title}
        </h2>
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55, color: 'var(--tour-body)' }}>{step.body}</div>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => close()} style={{ ...btn.base, ...btn.quiet }}>
            {last ? 'Close' : 'Skip the tour'}
          </button>
          {index > 0 && (
            <button onClick={() => setIndex(index - 1)} style={{ ...btn.base, ...btn.secondary }}>
              Back
            </button>
          )}
          <button
            autoFocus
            onClick={() => (last ? close(true) : setIndex(index + 1))}
            style={{ ...btn.base, ...btn.primary }}
          >
            {last ? finishLabel : index === 0 && !step.target ? 'Show me around' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
