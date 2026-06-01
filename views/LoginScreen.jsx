// src/views/LoginScreen.jsx
import { useState } from 'react';
import { supabase } from '../utils/supabase';
import { C } from '../utils/helpers';
import { Fld, RoleBdg } from '../components/UIPrimitives';

const COMPANY_DOMAIN = '@maumeeriverroofing.com';

export default function LoginScreen({ onLogin, activeLogo }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');

  const tryLogin = async () => {
    setErr('');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: pass,
    });

    if (authError) return setErr(authError.message);

    if (authData.user) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, role, active')
        .eq('id', authData.user.id)
        .single();

      if (profileError) return setErr("Failed to verify user profile access.");
      if (!profileData.active) return setErr("This account has been deactivated by an administrator.");

      onLogin({
        id: authData.user.id,
        email: authData.user.email,
        name: profileData.full_name,
        role: profileData.role, 
        active: profileData.active
      });
    }
  };

  const trySignup = async () => {
    setErr('');
    const trimmedEmail = email.trim().toLowerCase();

    if (!name.trim()) return setErr('Please enter your full name.');
    if (!trimmedEmail.endsWith(COMPANY_DOMAIN)) return setErr(`Use your ${COMPANY_DOMAIN} email address.`);
    if (!pass) return setErr('Please choose a password.');
    if (pass.length < 8) return setErr('Password must be at least 8 characters.');
    if (pass !== confirm) return setErr('Passwords do not match.');

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password: pass,
      options: { data: { full_name: name.trim(), role: 'employee' } },
    });

    if (authError) return setErr(authError.message);

    if (authData.user) {
      onLogin({
        id: authData.user.id,
        email: authData.user.email,
        name: name.trim(),
        role: 'employee',
        active: true
      });
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: `linear-gradient(135deg,${C.navy} 0%,${C.blue} 55%,${C.navy} 100%)`, display: 'flex', alignItems: 'center', justifycontent: 'center', padding: 16 }}>
      <div style={{ background: C.w, borderRadius: 18, padding: 36, width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,0.4)', margin: 'auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ width: 54, height: 54, background: C.gold, borderRadius: 14, display: 'flex', alignItems: 'center', justifycontent: 'center', overflow: 'hidden' }}>
              {activeLogo ? <img src={activeLogo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 28 }}>🏠</span>}
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.navy }}>MAUMEE RIVER</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, letterSpacing: '1px' }}>ROOFING</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.sub }}>{mode === 'login' ? 'Warehouse & Fleet Management System' : `Register with ${COMPANY_DOMAIN}`}</div>
        </div>
        {mode === 'signup' && <Fld label="Full Name"><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>}
        <Fld label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@maumeeriverroofing.com" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>
        <Fld label="Password"><input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && (mode === 'login' ? tryLogin() : trySignup())} placeholder="Password" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>
        {mode === 'signup' && <Fld label="Confirm Password"><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && trySignup()} placeholder="Confirm password" style={{ width: '100%', padding: '9px 11px', border: `1.5px solid ${C.bd}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} /></Fld>}
        {err && <div style={{ background: C.rB, color: C.rd, padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{err}</div>}
        <button onClick={() => mode === 'login' ? tryLogin() : trySignup()} style={{ width: '100%', padding: '12px', background: C.gold, color: C.navy, border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 800, cursor: 'pointer', marginBottom: 12 }}>{mode === 'login' ? 'Sign In →' : 'Create Account →'}</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: C.sub, marginTop: 16 }}>
  <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', padding: 0, fontWeight: 700 }}>
    {mode === 'login' ? 'Create an account' : 'Back to sign in'}
  </button>
  <span style={{ opacity: 0.7 }}>{COMPANY_DOMAIN}</span>
</div>
      </div>
    </div>
  );
}