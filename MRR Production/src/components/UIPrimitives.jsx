import { useRef } from 'react';
import { C } from '../utils/helpers';
import { ROLES } from '../database/permissions';
import { compressImg } from '../utils/helpers';

export function Spinner({ size = 18, color }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2.5px solid ${color ? `${color}33` : 'rgba(27,82,184,0.15)'}`,
        borderTopColor: color || C.blue,
        animation: 'mrr-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

export function LoadingState({ label = 'Loading...', compact = false }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        padding: compact ? 'var(--space-5) 0' : 'var(--space-9) 0',
      }}
    >
      <Spinner size={compact ? 16 : 22} />
      <span style={{ fontSize: 'var(--text-sm)', color: C.sub, fontWeight: 'var(--weight-semibold)' }}>{label}</span>
    </div>
  );
}

export function Modal({ title, onClose, children, wide, extraWide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,45,107,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-5)' }}>
      <div style={{ background: C.w, borderRadius: 'var(--radius-2xl)', width: '100%', maxWidth: extraWide ? 900 : wide ? 740 : 480, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: 'var(--space-7) var(--space-8)', borderBottom: `3px solid ${C.gold}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: C.w, zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-extrabold)', color: C.navy }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: C.sub, lineHeight: 1, padding: 'var(--space-1)' }}>×</button>
        </div>
        <div style={{ padding: 'var(--space-8)' }}>{children}</div>
      </div>
    </div>
  );
}

export function Fld({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: C.navy, marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
      {hint && <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--text-xs)', color: C.sub }}>{hint}</p>}
    </div>
  );
}

export function Inp(p) {
  return <input {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', boxSizing: 'border-box', background: C.w, ...p.style }} />;
}

export function TA(p) {
  return <textarea {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', boxSizing: 'border-box', background: C.w, resize: 'vertical', fontFamily: 'inherit', minHeight: 70, ...p.style }} />;
}

export function Sel({ children, ...p }) {
  return <select {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', background: C.w, boxSizing: 'border-box', ...p.style }}>{children}</select>;
}

export function Btn({ children, v = 'primary', sz = 'md', ...p }) {
  const vs = { primary: { background: C.blue, color: C.w, border: 'none' }, gold: { background: C.gold, color: C.navy, border: 'none' }, outline: { background: 'transparent', color: C.blue, border: `2px solid ${C.blue}` }, ghost: { background: C.lg, color: '#1A202C', border: 'none' }, danger: { background: C.rd, color: C.w, border: 'none' }, purple: { background: C.pu, color: C.w, border: 'none' }, green: { background: C.gr, color: C.w, border: 'none' }, teal: { background: C.tl, color: C.w, border: 'none' }, sky: { background: C.sl, color: C.w, border: 'none' } };
  const ss = { sm: { padding: '5px 11px', fontSize: 'var(--text-sm)' }, md: { padding: '9px 16px', fontSize: 'var(--text-base)' }, lg: { padding: '12px 22px', fontSize: 'var(--text-md)' } };
  return <button {...p} style={{ ...vs[v], ...ss[sz], borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 'var(--weight-bold)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', ...p.style }}>{children}</button>;
}

export function Bdg({ children, color = 'blue' }) {
  const bg = { blue: 'rgba(27,82,184,0.12)', green: C.gB, red: C.rB, amber: C.aB, gold: C.gL, purple: C.pB, gray: '#F1F5F9', teal: C.tB, sky: C.sB };
  const fg = { blue: C.blue, green: C.gr, red: C.rd, amber: C.am, gold: '#C78D00', purple: C.pu, gray: C.sub, teal: C.tl, sky: C.sl };
  return <span style={{ padding: '3px var(--space-3)', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', background: bg[color] || C.lg, color: fg[color] || C.sub, display: 'inline-block' }}>{children}</span>;
}

export function RoleBdg({ role }) {
  const r = ROLES[role] || { label: 'Employee', color: 'gray' };
  return <Bdg color={r.color}>{r.label}</Bdg>;
}

export function Toggle({ on, onChange, disabled = false }) {
  return (
    <div onClick={!disabled ? onChange : undefined} style={{ width: 38, height: 22, borderRadius: 'var(--radius-pill)', background: disabled ? '#CBD5E0' : on ? C.gr : '#CBD5E0', cursor: disabled ? 'default' : 'pointer', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: disabled ? '#A0AEC0' : C.w, transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  );
}

export function PhotoUpload({ current, onUpload, maxDim = 350, quality = 0.72, label = 'Upload Photo', previewHeight = 160 }) {
  const ref = useRef();
  const handle = e => { const f = e.target.files[0]; if (f) compressImg(f, maxDim, quality, onUpload); e.target.value = ''; };
  return (
    <div>
      {current ? (
        <div style={{ position: 'relative', marginBottom: 'var(--space-4)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: `1.5px solid ${C.bd}` }}>
          <img src={current} alt="" style={{ width: '100%', height: previewHeight, objectFit: 'cover', display: 'block' }} />
          <button onClick={() => onUpload(null)} style={{ position: 'absolute', top: 'var(--space-2)', right: 'var(--space-2)', background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
      ) : (
        <div style={{ height: previewHeight, background: C.lg, borderRadius: 'var(--radius-lg)', border: `2px dashed ${C.bd}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-4)', cursor: 'pointer', gap: 'var(--space-2)' }} onClick={() => ref.current.click()}>
          <span style={{ fontSize: 28 }}>📷</span>
          <span style={{ fontSize: 'var(--text-sm)', color: C.sub, fontWeight: 'var(--weight-semibold)' }}>{label}</span>
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" onChange={handle} style={{ display: 'none' }} />
    </div>
  );
}
