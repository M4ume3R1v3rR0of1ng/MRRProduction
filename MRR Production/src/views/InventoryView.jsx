// src/views/InventoryView.jsx
import { useState } from 'react';
import { supabase } from '../utils/supabase';
import { C, uid, fd, fm } from '../utils/helpers';
import { Btn, Bdg, Fld, Inp, Sel, Modal, PhotoUpload } from '../components/UIPrimitives';

// ── INTERNAL FILE UTILITY COUNTERS ─────────────────
const tot = (item) => {
  if (!item || !item.batches) return 0;
  return item.batches.reduce((s, b) => s + b.rem, 0);
};

const newestPrice = (item) => {
  if (!item || !item.batches || !item.batches.length) return 0;
  return [...item.batches].sort((a, b) => new Date(b.rcvd) - new Date(a.rcvd))[0].price;
};

export default function InventoryView({ inv, setInv, users, user, perms, invPhotos, setInvPhotos }) {
  const [srch, setSrch] = useState('');
  const [cat, setCat] = useState('All');
  const [modal, setModal] = useState(null);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({});
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkMeta, setBulkMeta] = useState({ date: new Date().toISOString().split('T')[0], po: '', vendor: '' });
  const [bulkSrch, setBulkSrch] = useState('');
  
  const cats = ['All', ...new Set(inv.map(i => i.cat).filter(Boolean))].sort();
  const filtered = inv.filter(i => i.name.toLowerCase().includes(srch.toLowerCase()) && (cat === 'All' || i.cat === cat));
  const sClr = i => { const s = tot(i); if (s <= i.alrt) return C.rd; if (s <= i.alrt * 1.5) return C.am; return C.gr; };
  const setPhoto = (id, data) => setInvPhotos(p => data ? { ...p, [id]: data } : Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)));

  const addItem = async () => {
    if (!form.name || !form.cat || !form.unit) return;
    
    const record = { 
      id: 'i_' + uid(), 
      name: form.name.trim(), 
      cat: form.cat, 
      unit: form.unit, 
      alrt: parseInt(form.alrt) || 5, 
      batches: [] 
    };

    const { error } = await supabase.from('inventory').insert([record]);

    if (error) {
      alert("Database Error adding item: " + error.message);
    } else {
      setInv(p => [...p, record]);
      setModal(null); 
      setForm({});
    }
  };

  const editItem = async () => {
    const updatedFields = { 
      name: form.name, 
      cat: form.cat, 
      unit: form.unit, 
      alrt: parseInt(form.alrt) || sel.alrt 
    };

    const { error } = await supabase
      .from('inventory')
      .update(updatedFields)
      .eq('id', sel.id);

    if (error) {
      alert("Database Error modifying catalog record: " + error.message);
    } else {
      setInv(p => p.map(i => i.id === sel.id ? { ...i, ...updatedFields } : i));
      setModal(null); 
      setForm({});
    }
  };

  const rcvBatch = async () => {
    if (!form.qty || !form.price || !form.date) return;
    
    const b = { 
      id: 'b_' + uid(), 
      rcvd: form.date, 
      qty: parseFloat(form.qty), 
      price: parseFloat(form.price) || newestPrice(sel), by: user.id, 
      rem: parseFloat(form.qty) 
    };
    
    const updatedBatches = [...sel.batches, b];

    const { error } = await supabase
      .from('inventory')
      .update({ batches: updatedBatches })
      .eq('id', sel.id);

    if (error) {
      alert("Database Error posting receipt batch: " + error.message);
    } else {
      setInv(p => p.map(i => i.id === sel.id ? { ...i, batches: updatedBatches } : i));
      setModal(null); 
      setForm({});
    }
  };

  const bulkFiltered = inv.filter(i => i.name.toLowerCase().includes(bulkSrch.toLowerCase()) && !bulkItems.find(b => b.iid === i.id));
  const addToBulk = item => setBulkItems(p => [...p, { iid: item.id, iname: item.name, unit: item.unit, qty: '', price: newestPrice(item) ? String(newestPrice(item)) : '' }]);
  const removeBulk = iid => setBulkItems(p => p.filter(b => b.iid !== iid));
  const updateBulk = (iid, field, val) => setBulkItems(p => p.map(b => b.iid === iid ? { ...b, [field]: val } : b));
  const bulkTotal = bulkItems.reduce((s, b) => s + (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0), 0);

  const confirmBulk = async () => {
    if (!bulkMeta.date) { alert('Please set a received date.'); return; }
    const valid = bulkItems.filter(b => parseFloat(b.qty) > 0);
    if (valid.length === 0) { alert('Add at least one item with a quantity > 0.'); return; }

    const stateSnapshot = inv.map(item => {
      const bi = valid.find(b => b.iid === item.id);
      if (!bi) return item;
      const nb = { 
        id: 'b_' + uid(), 
        rcvd: bulkMeta.date, 
        qty: parseFloat(bi.qty), 
        price: parseFloat(bi.price) || 0, 
        by: user.id, 
        rem: parseFloat(bi.qty), 
        ref: bulkMeta.po || '', 
        vendor: bulkMeta.vendor || '' 
      };
      return { ...item, batches: [...item.batches, nb] };
    });

    try {
      await Promise.all(
        valid.map(bi => {
          const matchingItem = inv.find(i => i.id === bi.iid);
          const nb = { 
            id: 'b_' + uid(), 
            rcvd: bulkMeta.date, 
            qty: parseFloat(bi.qty), 
            price: parseFloat(bi.price) || 0, 
            by: user.id, 
            rem: parseFloat(bi.qty), 
            ref: bulkMeta.po || '', 
            vendor: bulkMeta.vendor || '' 
          };
          return supabase
            .from('inventory')
            .update({ batches: [...matchingItem.batches, nb] })
            .eq('id', bi.iid);
        })
      );
      
      setInv(stateSnapshot);
      setModal(null); 
      setBulkItems([]); 
      setBulkMeta({ date: new Date().toISOString().split('T')[0], po: '', vendor: '' }); 
      setBulkSrch('');
    } catch (err) {
      alert("Error logging batch payload operations: " + err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.navy }}>📦 Inventory</h1>
          <p style={{ margin: '2px 0 0', color: C.sub, fontSize: 12 }}>{inv.length} items</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {perms.inv_bulk_receive && <Btn v="gold" onClick={() => { setBulkItems([]); setBulkMeta({ date: new Date().toISOString().split('T')[0], po: '', vendor: '' }); setBulkSrch(''); setModal('bulk'); }}>📦 Receive Bulk Order</Btn>}
          {perms.inv_edit && <Btn v="primary" onClick={() => { setModal('add'); setForm({ unit: 'rolls', alrt: '10' }); }}>+ Add Item</Btn>}
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Inp placeholder="🔍 Search items..." value={srch} onChange={e => setSrch(e.target.value)} style={{ flex: 1, minWidth: 160, maxWidth: 300 }} />
        <Sel value={cat} onChange={e => setCat(e.target.value)} style={{ width: 'auto' }}>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </Sel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
        {filtered.map(item => {
          const stock = tot(item);
          const isLow = stock <= item.alrt;
          const photo = invPhotos[item.id];
          return (
            <div key={item.id} onClick={() => { setSel(item); setModal('detail'); }} style={{ background: C.w, borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', border: `2px solid ${isLow ? C.rd : 'transparent'}`, cursor: 'pointer' }}>
              {photo ? <div style={{ height: 110, overflow: 'hidden', background: C.lg }}><img src={photo} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div> : <div style={{ height: 6, background: sClr(item) }} />}
              <div style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800, color: C.navy, fontSize: 13 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: C.sub }}>{item.cat}</div>
                  </div>
                  {isLow && <span style={{ fontSize: 16 }}>🚨</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: sClr(item) }}>{stock}</div>
                    <div style={{ fontSize: 11, color: C.sub }}>{item.unit} in stock</div>
                  </div>
                  {perms.inv_pricing_view ? (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.blue }}>{fm(newestPrice(item))}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>per {item.unit.replace(/s$/, '')}</div>
                    </div>
                  ) : <div style={{ fontSize: 11, color: C.sub }}>Pricing restricted</div>}
                </div>
                {!photo && <div style={{ marginTop: 8, height: 4, background: C.lg, borderRadius: 2 }}><div style={{ height: '100%', background: sClr(item), borderRadius: 2, width: `${Math.min(100, (stock / (item.alrt * 3)) * 100)}%` }} /></div>}
                <div style={{ fontSize: 10, color: C.sub, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Alert: {item.alrt} {item.unit}</span>
                  <span>{item.batches.length} batch{item.batches.length !== 1 ? 'es' : ''}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal === 'detail' && sel && (
        <Modal title={sel.name} onClose={() => setModal(null)} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Product Photo</div>
              <PhotoUpload current={invPhotos[sel.id] || null} onUpload={data => setPhoto(sel.id, data)} label="Upload product photo" previewHeight={180} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Item Details</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[['Total Stock', `${tot(sel)} ${sel.unit}`], ['Category', sel.cat], ['Unit', sel.unit], ...(perms.inv_pricing_view ? [['Current Price', fm(newestPrice(sel))], ['Low Alert', `${sel.alrt} ${sel.unit}`]] : [['Low Alert', `${sel.alrt} ${sel.unit}`]]), ['Batches', sel.batches.length]].map(([k, v]) => (
                  <div key={k} style={{ background: C.lg, borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: 'uppercase' }}>{k}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {perms.inv_edit && <Btn v="outline" sz="sm" onClick={() => { setForm({ name: sel.name, cat: sel.cat, unit: sel.unit, alrt: sel.alrt }); setModal('edit'); }}>✏️ Edit</Btn>}
                {perms.inv_receive && <Btn v="primary" sz="sm" onClick={() => { setForm({ date: new Date().toISOString().split('T')[0] }); setModal('rcv'); }}>+ Receive Batch</Btn>}
                {perms.inv_edit && (
                  <Btn v="danger" sz="sm" onClick={async () => { 
                    if(window.confirm(`Permanently delete ${sel.name} from inventory?`)) { 
                      const { error } = await supabase.from('inventory').delete().eq('id', sel.id);
                      if (error) alert("Database Error: " + error.message);
                      else {
                        setInv(p => p.filter(i => i.id !== sel.id)); 
                        setModal(null); 
                      }
                    } 
                  }}>
                    🗑️ Delete Product
                  </Btn>
                )}
              </div>
            </div>
          </div>
          <h4 style={{ margin: '0 0 8px', color: C.navy, fontSize: 12, textTransform: 'uppercase' }}>Batch History (FIFO)</h4>
          {[...sel.batches].sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd)).map((b, i) => (
            <div key={b.id} style={{ padding: '10px 14px', background: i === 0 && b.rem > 0 ? 'rgba(27,82,184,0.08)' : C.lg, borderRadius: 8, border: i === 0 && b.rem > 0 ? `1.5px solid ${C.blue}` : 'none', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>
                    {i === 0 && b.rem > 0 && <span style={{ color: C.blue }}>▶ ACTIVE · </span>}{fd(b.rcvd)}{b.vendor && <span style={{ color: C.sub }}> · {b.vendor}</span>}{b.ref && <span style={{ color: C.tl }}> · {b.ref}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.sub }}>By: {users.find(u => u.id === b.by)?.name || 'Unknown'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: b.rem === 0 ? C.sub : C.gr, fontSize: 12 }}>{b.rem}/{b.qty} remaining</div>
                  {perms.inv_pricing_view && <div style={{ fontSize: 11, color: C.blue, fontWeight: 700 }}>{fm(b.price)} ea.</div>}
                </div>
              </div>
            </div>
          ))}
          {sel.batches.length === 0 && <p style={{ color: C.sub, fontSize: 13 }}>No batches yet.</p>}
        </Modal>
      )} 

      {modal === 'add' && (
        <Modal title="Add New Item" onClose={() => setModal(null)}>
          <Fld label="Item Name"><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Drip Edge - White" /></Fld>
          <Fld label="Category">
            <Sel value={form.cat || ''} onChange={e => setForm({ ...form, cat: e.target.value })}>
              <option value="">— Select a category —</option>
              {['Roofing Materials', 'Fasteners', 'Sealants', 'Ventilation', 'Decking', 'Sheet Metal', 'Accessories', 'Tools'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label="Unit">
            <Sel value={form.unit || 'rolls'} onChange={e => setForm({ ...form, unit: e.target.value })}>
              {['rolls', 'boxes', 'each', 'tubes', 'bundles', 'packs', 'sheets', 'gallons', 'lbs'].map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label="Low Alert Threshold"><Inp type="number" value={form.alrt || ''} onChange={e => setForm({ ...form, alrt: e.target.value })} /></Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={addItem} style={{ flex: 1, justifyContent: 'center' }}>Add Item</Btn>
          </div>
        </Modal>
      )}

      {modal === 'edit' && sel && (
        <Modal title={`Edit: ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Item Name"><Inp value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Fld>
          <Fld label="Category">
            <Sel value={form.cat || ''} onChange={e => setForm({ ...form, cat: e.target.value })}>
              <option value="">— Select a category —</option>
              {['Roofing Materials', 'Fasteners', 'Sealants', 'Ventilation', 'Decking', 'Sheet Metal', 'Accessories', 'Tools'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label="Unit">
            <Sel value={form.unit || 'rolls'} onChange={e => setForm({ ...form, unit: e.target.value })}>
              {['rolls', 'boxes', 'each', 'tubes', 'bundles', 'packs', 'sheets', 'gallons', 'lbs'].map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Sel>
          </Fld>
          <Fld label="Low Alert"><Inp type="number" value={form.alrt || ''} onChange={e => setForm({ ...form, alrt: e.target.value })} /></Fld>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={editItem} style={{ flex: 1, justifyContent: 'center' }}>Save</Btn>
          </div>
        </Modal>
      )}

      {modal === 'rcv' && sel && (
        <Modal title={`Receive: ${sel.name}`} onClose={() => setModal(null)}>
          <Fld label="Date Received"><Inp type="date" value={form.date || ''} onChange={e => setForm({ ...form, date: e.target.value })} /></Fld>
          <Fld label={`Quantity (${sel.unit})`}><Inp type="number" value={form.qty || ''} onChange={e => setForm({ ...form, qty: e.target.value })} /></Fld>
          {perms.inv_pricing_edit ? (
            <Fld label="Price Per Unit">
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.sub }}>$</span>
                <Inp type="number" step="0.01" value={form.price || ''} onChange={e => setForm({ ...form, price: e.target.value })} style={{ paddingLeft: 22 }} />
              </div>
            </Fld>
          ) : <div style={{ background: C.aB, border: `1px solid ${C.am}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: C.am }}>Pricing is set by authorized personnel. Price will carry over from the last batch.</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => setModal(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="primary" onClick={rcvBatch} style={{ flex: 1, justifyContent: 'center' }}>Receive</Btn>
          </div>
        </Modal>
      )}

      {modal === 'bulk' && perms.inv_bulk_receive && (
        <Modal title="📦 Receive Bulk Order" onClose={() => { setModal(null); setBulkItems([]); setBulkSrch(''); }} wide>
          <div style={{ background: C.gL, border: `1.5px solid ${C.gold}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.navy }}>⭐ <strong>FIFO applied automatically.</strong> Each item gets one new batch. Older batches are consumed first.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: 14, background: C.lg, borderRadius: 10, marginBottom: 16 }}>
            <Fld label="Date Received *"><Inp type="date" value={bulkMeta.date} onChange={e => setBulkMeta({ ...bulkMeta, date: e.target.value })} /></Fld>
            <Fld label="PO / Order #"><Inp value={bulkMeta.po} onChange={e => setBulkMeta({ ...bulkMeta, po: e.target.value })} placeholder="e.g. PO-2025-100" /></Fld>
            <Fld label="Vendor / Supplier"><Inp value={bulkMeta.vendor} onChange={e => setBulkMeta({ ...bulkMeta, vendor: e.target.value })} placeholder="e.g. ABC Roofing Supply" /></Fld>
          </div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Select Items to Receive</div>
              <Inp value={bulkSrch} onChange={e => setBulkSrch(e.target.value)} placeholder="🔍 Search inventory..." style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {bulkFiltered.map(item => (
                  <div key={item.id} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: 8, padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: C.sub }}>{item.cat} · {tot(item)} {item.unit} in stock</div>
                    </div>
                    <Btn v="primary" sz="sm" onClick={() => addToBulk(item)}>+ Add</Btn>
                  </div>
                ))}
                {bulkFiltered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: C.sub, fontSize: 12, background: C.lg, borderRadius: 8 }}>{bulkItems.length > 0 ? 'All items added ✓' : 'No items found'}</div>}
              </div>
            </div>
            <div style={{ flex: '0 0 360px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Order Items {bulkItems.length > 0 && `(${bulkItems.length})`}</div>
                {bulkItems.length > 0 && <button onClick={() => setBulkItems([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.rd, fontSize: 11, fontWeight: 700 }}>Clear All</button>}
              </div>
              {bulkItems.length === 0 ? (
                <div style={{ height: 200, background: C.lg, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.sub, gap: 8 }}>
                  <span style={{ fontSize: 32 }}>📋</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>No items added yet</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', marginBottom: 10 }}>
  {bulkItems.map(b => {
    const sub = (parseFloat(b.qty) || 0) * (parseFloat(b.price) || 0);
    return (
      <div key={b.iid} style={{ background: C.w, border: `1.5px solid ${C.bd}`, borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                            <span style={{ fontWeight: 700, color: C.navy, fontSize: 12 }}>{b.iname}</span>
                            <button onClick={() => removeBulk(b.iid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.rd, fontSize: 18, lineHeight: 1 }}>×</button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Qty ({b.unit})</div>
                              <Inp type="number" min="1" value={b.qty} onChange={e => updateBulk(b.iid, 'qty', e.target.value)} placeholder="0" style={{ padding: '5px 8px' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Unit Price</div>
                              <div style={{ position: 'relative' }}>
                                <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: C.sub, fontSize: 11 }}>$</span>
                                {perms.inv_pricing_edit ? <Inp type="number" step="0.01" min="0" value={b.price} onChange={e => updateBulk(b.iid, 'price', e.target.value)} placeholder="0.00" style={{ padding: '5px 8px', paddingLeft: 16 }} /> : <Inp value={b.price} readOnly style={{ padding: '5px 8px', paddingLeft: 16, color: C.sub, background: C.lg }} />}
                              </div>
                            </div>
                            <div style={{ paddingBottom: 2, textAlign: 'right' }}>
                              <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Subtotal</div>
                              <div style={{ fontSize: 13, fontWeight: 800, color: sub > 0 ? C.gr : C.sub }}>{fm(sub)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ background: C.navy, borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Order Total</div>
                      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 }}>{bulkItems.filter(b => parseFloat(b.qty) > 0).length} of {bulkItems.length} items with quantities</div>
                    </div>
                    <div style={{ fontWeight: 900, fontSize: 22, color: C.gold }}>{fm(bulkTotal)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={() => { setModal(null); setBulkItems([]); setBulkSrch(''); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Btn>
            <Btn v="gold" sz="lg" onClick={confirmBulk} style={{ flex: 2, justifyContent: 'center' }}>✅ Receive {bulkItems.filter(b => parseFloat(b.qty) > 0).length > 0 ? `${bulkItems.filter(b => parseFloat(b.qty) > 0).length} Items ` : ''}into Warehouse</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}