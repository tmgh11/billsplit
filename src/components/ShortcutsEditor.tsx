import { useLayoutEffect, useRef, useState } from 'react';
import { store, useStore } from '../lib/store';
import { DEFAULT_SHORTCUTS, SHORTCUT_MAX_LENGTH } from '../lib/types';

const SLOTS = 4;

/** Clean up what was typed: trimmed, no blanks, no repeats (ignoring case). */
function tidy(list: string[]) {
  const seen = new Set<string>();
  return list
    .map((s) => s.trim().slice(0, SHORTCUT_MAX_LENGTH))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

const pad = (list: string[]) => [...list, ...Array(SLOTS).fill('')].slice(0, SLOTS);

/**
 * Settings → the four one-tap descriptions offered in Add expense. The preview is drawn exactly as
 * Add expense draws them, at the sheet's width, so it can say whether they fit on one line. Not
 * fitting is allowed (they wrap onto a second row); it's only a heads-up.
 */
export function ShortcutsEditor() {
  const { settings } = useStore();
  const [drafts, setDrafts] = useState(() => pad(settings.shortcuts));
  // What's in the boxes right now: saving on blur reads this, since a blur can arrive before the
  // re-render that would give the handler the newest text.
  const latest = useRef(drafts);
  const edit = (next: string[]) => {
    latest.current = next;
    setDrafts(next);
  };
  const [wraps, setWraps] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const preview = tidy(drafts);

  const save = (list: string[]) => {
    const clean = tidy(list);
    if (clean.join('\n') !== settings.shortcuts.join('\n')) store.updateSettings({ shortcuts: clean });
    edit(pad(clean)); // the boxes show exactly what was saved (blanks and repeats dropped)
  };

  // Do the chips spill onto a second row? Measured, since width depends on the letters, not the count.
  useLayoutEffect(() => {
    const measure = () => {
      const chips = [...(previewRef.current?.children ?? [])] as HTMLElement[];
      setWraps(new Set(chips.map((c) => c.offsetTop)).size > 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [preview.join('\n')]);

  return (
    <>
      <div className="section-title">Add expense shortcuts</div>
      <div className="card set-group">
        {drafts.map((d, i) => (
          <label key={i} className="set-row">
            <span className="muted" style={{ width: 16, fontWeight: 700 }}>{i + 1}</span>
            <input
              className="input grow"
              value={d}
              maxLength={SHORTCUT_MAX_LENGTH}
              placeholder="e.g. Waitrose"
              onChange={(e) => edit(latest.current.map((v, j) => (j === i ? e.target.value : v)))}
              onBlur={() => save(latest.current)}
              aria-label={`Shortcut ${i + 1}`}
              autoCapitalize="words"
            />
            <span className="muted num" style={{ width: 44, textAlign: 'right', fontSize: 13 }} aria-hidden="true">
              {d.length}/{SHORTCUT_MAX_LENGTH}
            </span>
          </label>
        ))}
      </div>

      <div className="field-label" style={{ margin: '14px 2px 0' }}>Preview</div>
      {/* same width as the Add expense sheet's content, so the wrap check matches what you'll see */}
      <div className="shortcuts" ref={previewRef} style={{ width: 'min(calc(100vw - 40px), 520px)' }} aria-label="Preview">
        {preview.map((s) => (
          <span key={s} className="chip">{s}</span>
        ))}
      </div>
      <p className="small-print" role={wraps ? 'status' : undefined} style={wraps ? { color: 'var(--text)' } : undefined}>
        {wraps
          ? 'These don’t fit on one line, so they’ll show on two rows in Add expense. Shorten one to keep them on one row.'
          : `Up to ${SHORTCUT_MAX_LENGTH} characters each. Tapping one fills in the description and picks the category, just as if you’d typed it.`}
      </p>
      <button
        type="button"
        className="btn small link-btn"
        onClick={() => {
          edit(pad(DEFAULT_SHORTCUTS));
          save(DEFAULT_SHORTCUTS);
        }}
      >
        Reset to defaults
      </button>
    </>
  );
}
