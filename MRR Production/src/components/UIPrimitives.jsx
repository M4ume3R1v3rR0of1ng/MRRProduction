import { useRef } from 'react';
import { C } from '../utils/helpers';
import { ROLES } from '../database/permissions';
import { compressImg } from '../utils/helpers';

export function Modal({ title, onClose, children, wide, extraWide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(14,45,107,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: C.w, borderRadius: 14, width: '100%', maxWidth: extraWide ? 900 : wide ? 740 : 480, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `3px solid ${C.gold}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: C.w, zIndex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.navy }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, color: C.sub, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

export function Fld({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.navy, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
      {hint && <p style={{ margin: '3px 0 0', fontSize: 11, color: C.sub }}>{hint}</p>}
    </div>
  );
}

export function Inp(p) {
  return <input {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: C.w, ...p.style }} />;
}

export function TA(p) {
  return <textarea {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: C.w, resize: 'vertical', fontFamily: 'inherit', minHeight: 70, ...p.style }} />;
}

export function Sel({ children, ...p }) {
  return <select {...p} style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, background: C.w, boxSizing: 'border-box', ...p.style }}>{children}</select>;
}

export function Btn({ children, v = 'primary', sz = 'md', ...p }) {
  const vs = { primary: { background: C.blue, color: C.w, border: 'none' }, gold: { background: C.gold, color: C.navy, border: 'none' }, outline: { background: 'transparent', color: C.blue, border: `2px solid ${C.blue}` }, ghost: { background: C.lg, color: '#1A202C', border: 'none' }, danger: { background: C.rd, color: C.w, border: 'none' }, purple: { background: C.pu, color: C.w, border: 'none' }, green: { background: C.gr, color: C.w, border: 'none' }, teal: { background: C.tl, color: C.w, border: 'none' }, sky: { background: C.sl, color: C.w, border: 'none' } };
  const ss = { sm: { padding: '5px 11px', fontSize: 12 }, md: { padding: '9px 16px', fontSize: 13 }, lg: { padding: '12px 22px', fontSize: 15 } };
  return <button {...p} style={{ ...vs[v], ...ss[sz], borderRadius: 8, cursor: 'pointer', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, ...p.style }}>{children}</button>;
}

export function Bdg({ children, color = 'blue' }) {
  const bg = { blue: 'rgba(27,82,184,0.12)', green: C.gB, red: C.rB, amber: C.aB, gold: C.gL, purple: C.pB, gray: '#F1F5F9', teal: C.tB, sky: C.sB };
  const fg = { blue: C.blue, green: C.gr, red: C.rd, amber: C.am, gold: '#C78D00', purple: C.pu, gray: C.sub, teal: C.tl, sky: C.sl };
  return <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg[color] || C.lg, color: fg[color] || C.sub, display: 'inline-block' }}>{children}</span>;
}

export function RoleBdg({ role }) {
  const r = ROLES[role] || { label: 'Employee', color: 'gray' };
  return <Bdg color={r.color}>{r.label}</Bdg>;
}

export function Toggle({ on, onChange, disabled = false }) {
  return (
    <div onClick={!disabled ? onChange : undefined} style={{ width: 38, height: 22, borderRadius: 11, background: disabled ? '#CBD5E0' : on ? C.gr : '#CBD5E0', cursor: disabled ? 'default' : 'pointer', position: 'relative', transition: 'background 0.15s', flexShrink: 0 }}>
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
        <div style={{ position: 'relative', marginBottom: 10, borderRadius: 10, overflow: 'hidden', border: `1.5px solid ${C.bd}` }}>
          <img src={current} alt="" style={{ width: '100%', height: previewHeight, objectFit: 'cover', display: 'block' }} />
          <button onClick={() => onUpload(null)} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
      ) : (
        <div style={{ height: previewHeight, background: C.lg, borderRadius: 10, border: `2px dashed ${C.bd}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginBottom: 10, cursor: 'pointer', gap: 6 }} onClick={() => ref.current.click()}>
          <span style={{ fontSize: 28 }}>📷</span>
          <span style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>{label}</span>
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" onChange={handle} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn v="ghost" sz="sm" onClick={() => ref.current.click()} style={{ flex: 1, justifyContent: 'center' }}>📷 {current ? 'Change' : 'Upload'} Photo</Btn>
        {current && <Btn v="ghost" sz="sm" onClick={() => onUpload(null)} style={{ color: C.rd }}>🗑️</Btn>}
      </div>
    </div>
  );
}