import { useState, useEffect } from 'react'
import axios from 'axios'
import { ExternalLink, Edit, CheckCircle, Copy, Search, Loader2, Plus, X, RefreshCw, Trash2 } from 'lucide-react'

const API_BASE = 'https://newsradar-mcp-server.onrender.com'
const NEWSRADAR_URL = 'https://newsradar-d433a.web.app'

function buildPrompt(titolo, url, testo) {
  return [
    'Sei un esperto di comunicazione digitale per imprenditori.',
    'Leggi la notizia qui sotto e scrivi uno script per un Reel Instagram.',
    '',
    'REGOLE FONDAMENTALI:',
    '- Scrivi SOLO il testo da dire nel video, niente didascalie o note di regia',
    '- Tono diretto, concreto, da imprenditore a imprenditore',
    '- Filtra il gergo tecnico e traducilo in impatto pratico per chi ha un\'azienda',
    '- La domanda guida è sempre: "cosa significa concretamente per te che hai un\'azienda?"',
    '- Durata: 30-45 secondi di parlato (circa 80-110 parole)',
    '- Struttura obbligatoria:',
    '  1. GANCIO (5 sec) — LA NOTIZIA stessa, raccontata in modo diretto: cosa è successo, chi, quando. Niente domande retoriche. Parti dal fatto concreto.',
    '  2. SPIEGAZIONE (10 sec) — approfondisci la notizia: come funziona, perché è successo, qual è il contesto. Spiega semplice, zero gergo tecnico.',
    '  3. IMPATTO PRATICO (20 sec) — analizza cosa cambia per un imprenditore italiano oggi: come può essere utile o pericoloso? Cosa fare o non fare?',
    '  4. CHIUSURA (5 sec) — una frase ad effetto o una domanda che invita a riflettere',
    '',
    'NOTIZIA:',
    'Titolo: ' + titolo,
    'URL: ' + url,
    testo ? 'Testo estratto: ' + testo : '',
    '',
    'Scrivi solo lo script, senza titoli di sezione o parentesi. Testo fluido come se stessi parlando.'
  ].filter(l => l !== undefined).join('\n')
}

/* ── TOAST ── */
function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 100, background: '#1a2035', border: '1px solid #252d4a',
      color: '#eef0f8', padding: '11px 20px', borderRadius: 10,
      boxShadow: '0 8px 28px rgba(0,0,0,0.5)', fontSize: '0.85rem',
      fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10,
      whiteSpace: 'nowrap'
    }}>
      <CheckCircle size={15} style={{ color: '#22d3a5', flexShrink: 0 }} />
      {message}
    </div>
  )
}

/* ── STATUS BADGE ── */
function StatusBadge({ status }) {
  const map = {
    'Da elaborare':   { bg: 'rgba(245,166,35,0.1)',  border: 'rgba(245,166,35,0.25)',  color: '#fbbf24' },
    'In lavorazione': { bg: 'rgba(91,124,246,0.1)',  border: 'rgba(91,124,246,0.25)', color: '#818cf8' },
    'Elaborato':      { bg: 'rgba(34,211,165,0.1)',  border: 'rgba(34,211,165,0.25)', color: '#22d3a5' },
    'Pubblicato':     { bg: 'rgba(139,92,246,0.1)',  border: 'rgba(139,92,246,0.25)', color: '#a78bfa' },
  }
  const s = map[status] || { bg: 'rgba(100,100,100,0.1)', border: 'rgba(100,100,100,0.2)', color: '#9ca3af' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: s.bg, border: '1px solid ' + s.border, color: s.color,
      borderRadius: 5, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 700,
      fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.02em'
    }}>
      {status}
    </span>
  )
}

/* ── MAIN APP ── */
export default function App() {
  const [articoli, setArticoli]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [filter, setFilter]         = useState('Tutti')
  const [search, setSearch]         = useState('')
  const [toast, setToast]           = useState(null)
  const [expanded, setExpanded]     = useState({})

  // Modal Gemini
  const [geminiArticle, setGeminiArticle]   = useState(null)
  const [extractedText, setExtractedText]   = useState('')
  const [extractLoading, setExtractLoading] = useState(false)
  const [reelTesto, setReelTesto]           = useState('')
  const [saving, setSaving]                 = useState(false)

  // Modal modifica
  const [editModal, setEditModal] = useState(null)
  const [editText, setEditText]   = useState('')

  // Modal aggiungi
  const [addModal, setAddModal]   = useState(false)
  const [newCard, setNewCard]     = useState({ titolo: '', url: '', fonte: '' })
  const [addLoading, setAddLoading] = useState(false)

  const showToast = msg => setToast(msg)

  useEffect(() => { fetchArticoli() }, [])

  const fetchArticoli = async () => {
    setLoading(true); setError(null)
    try {
      const res = await axios.get(API_BASE + '/hub/articoli')
      if (res.data.ok) setArticoli(res.data.articoli.reverse())
      else setError(res.data.error || 'Errore caricamento')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const updateStatus = async (riga, status) => {
    setArticoli(prev => prev.map(a => a.riga === riga ? { ...a, status } : a))
    try { await axios.patch(API_BASE + '/hub/articoli/' + riga, { status }) }
    catch { showToast('❌ Errore aggiornamento'); fetchArticoli() }
  }

  const eliminaScheda = async (riga, titolo) => {
    if (!window.confirm('Eliminare "' + titolo + '"?')) return
    try {
      await axios.delete(API_BASE + '/hub/articoli/' + riga)
      setArticoli(prev => prev.filter(a => a.riga !== riga))
      showToast('🗑️ Scheda eliminata')
    } catch { showToast('❌ Errore eliminazione') }
  }

  const saveReel = async () => {
    if (!geminiArticle || !reelTesto.trim()) return
    setSaving(true)
    try {
      await axios.patch(API_BASE + '/hub/articoli/' + geminiArticle.riga, { status: 'Elaborato', testo: reelTesto })
      setArticoli(prev => prev.map(a =>
        a.riga === geminiArticle.riga ? { ...a, status: 'Elaborato', testoElaborato: reelTesto } : a
      ))
      closeGeminiModal()
      showToast('✅ Script Reel salvato!')
    } catch { showToast('❌ Errore salvataggio') }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
    if (!editModal) return
    try {
      await axios.patch(API_BASE + '/hub/articoli/' + editModal.riga, { testo: editText })
      setArticoli(prev => prev.map(a => a.riga === editModal.riga ? { ...a, testoElaborato: editText } : a))
      setEditModal(null)
      showToast('✅ Testo aggiornato!')
    } catch { showToast('❌ Errore salvataggio') }
  }

  const aggiungiScheda = async () => {
    if (!newCard.titolo.trim() || !newCard.url.trim()) return
    setAddLoading(true)
    try {
      await axios.post(API_BASE + '/hub/aggiungi', newCard)
      setAddModal(false)
      setNewCard({ titolo: '', url: '', fonte: '' })
      showToast('✅ Scheda aggiunta!')
      fetchArticoli()
    } catch { showToast('❌ Errore aggiunta') }
    finally { setAddLoading(false) }
  }

  const openGeminiModal = async (articolo) => {
    setGeminiArticle(articolo)
    setReelTesto('')
    setExtractedText('')
    if (articolo.status === 'Da elaborare') updateStatus(articolo.riga, 'In lavorazione')
    setExtractLoading(true)
    try {
      const res = await axios.get(API_BASE + '/hub/estrai?url=' + encodeURIComponent(articolo.url))
      if (res.data.ok) setExtractedText(res.data.testo)
    } catch {}
    finally { setExtractLoading(false) }
  }

  const closeGeminiModal = () => { setGeminiArticle(null); setExtractedText(''); setReelTesto('') }

  const copyPrompt = () => {
    if (!geminiArticle) return
    navigator.clipboard.writeText(buildPrompt(geminiArticle.titolo, geminiArticle.url, extractedText))
    showToast('📋 Prompt copiato!')
  }

  const filtered = articoli.filter(a => {
    return (filter === 'Tutti' || a.status === filter) &&
           a.titolo.toLowerCase().includes(search.toLowerCase())
  })

  const counts = {
    'Tutti':        articoli.length,
    'Da elaborare': articoli.filter(a => a.status === 'Da elaborare').length,
    'Elaborato':    articoli.filter(a => a.status === 'Elaborato').length,
    'Pubblicato':   articoli.filter(a => a.status === 'Pubblicato').length,
  }

  const S = { // style shortcuts
    surface:  { background: '#0f1220', border: '1px solid #1e2540' },
    surface2: { background: '#141828', border: '1px solid #252d4a' },
    input:    { background: '#07080f', border: '1px solid #1e2540', color: '#eef0f8', borderRadius: 7, padding: '9px 12px', fontSize: '0.84rem', outline: 'none', fontFamily: 'DM Sans, sans-serif', width: '100%', boxSizing: 'border-box' },
    btnPrimary: { background: 'linear-gradient(135deg,#5b7cf6,#8b5cf6)', border: 'none', color: '#fff', borderRadius: 7, padding: '8px 18px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'DM Sans, sans-serif' },
    btnGhost: { background: 'none', border: '1px solid #1e2540', color: '#8892b0', borderRadius: 7, padding: '8px 14px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' },
  }

  return (
    <div style={{ minHeight: '100vh', background: '#07080f', fontFamily: 'DM Sans, sans-serif', color: '#eef0f8' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <header style={{ background: 'rgba(7,8,15,0.95)', borderBottom: '1px solid #1e2540', padding: '0 24px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 40, backdropFilter: 'blur(20px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: 'linear-gradient(135deg,#5b7cf6,#8b5cf6)', width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📡</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em' }}>NewsRadar <span style={{ color: '#5b7cf6' }}>Hub</span></div>
            <div style={{ color: '#4a5270', fontSize: '0.65rem', lineHeight: 1 }}>Script Reel Instagram</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a href={NEWSRADAR_URL} target="_blank" rel="noopener noreferrer"
            style={{ background: '#141828', border: '1px solid #252d4a', color: '#8892b0', borderRadius: 7, padding: '6px 13px', fontSize: '0.78rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
            ← NewsRadar <ExternalLink size={11} />
          </a>
          <button onClick={fetchArticoli} style={{ background: '#141828', border: '1px solid #252d4a', color: '#8892b0', borderRadius: 7, padding: '7px 9px', cursor: 'pointer' }}>
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setAddModal(true)} style={{ ...S.btnPrimary, padding: '7px 14px', fontSize: '0.8rem' }}>
            <Plus size={14} /> Aggiungi
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px' }}>

        {/* TOOLBAR */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#4a5270' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Cerca titolo..."
              style={{ ...S.input, paddingLeft: 32 }} />
          </div>
          <div style={{ display: 'flex', background: '#0f1220', border: '1px solid #1e2540', borderRadius: 8, overflow: 'hidden' }}>
            {Object.entries(counts).map(([f, n]) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '7px 13px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', border: 'none',
                background: filter === f ? 'linear-gradient(135deg,#5b7cf6,#8b5cf6)' : 'transparent',
                color: filter === f ? '#fff' : '#8892b0', fontFamily: 'DM Sans, sans-serif',
                transition: 'all 0.15s'
              }}>
                {f} <span style={{ opacity: 0.65, fontSize: '0.68rem' }}>({n})</span>
              </button>
            ))}
          </div>
        </div>

        {/* GRID */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 260 }}>
            <Loader2 className="animate-spin" size={36} style={{ color: '#5b7cf6' }} />
          </div>
        ) : error ? (
          <div style={{ background: 'rgba(245,101,101,0.08)', border: '1px solid rgba(245,101,101,0.2)', color: '#f87171', padding: 14, borderRadius: 10, fontSize: '0.85rem' }}>{error}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))', gap: 14 }}>
            {filtered.map(a => (
              <Card key={a.riga} articolo={a}
                expanded={!!expanded[a.riga]}
                onExpand={() => setExpanded(p => ({ ...p, [a.riga]: !p[a.riga] }))}
                onGemini={() => openGeminiModal(a)}
                onPubblica={() => updateStatus(a.riga, 'Pubblicato')}
                onAnnulla={() => updateStatus(a.riga, 'Elaborato')}
                onEdit={() => { setEditModal(a); setEditText(a.testoElaborato || '') }}
                onCopy={() => { navigator.clipboard.writeText(a.testoElaborato || ''); showToast('📋 Copiato!') }}
                onElimina={() => eliminaScheda(a.riga, a.titolo)}
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#4a5270', padding: 60, fontSize: '0.9rem' }}>
                Nessuna scheda trovata.
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL GEMINI */}
      {geminiArticle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, backdropFilter: 'blur(4px)' }}>
          <div style={{ ...S.surface, borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
            {/* header */}
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #1e2540', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Logo Gemini ufficiale */}
                <svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M14 28C14 26.0633 13.6267 24.2433 12.88 22.54C12.1567 20.8367 11.165 19.355 9.905 18.095C8.645 16.835 7.16333 15.8433 5.46 15.12C3.75667 14.3733 1.93667 14 0 14C1.93667 14 3.75667 13.6383 5.46 12.915C7.16333 12.1683 8.645 11.165 9.905 9.905C11.165 8.645 12.1567 7.16333 12.88 5.46C13.6267 3.75667 14 1.93667 14 0C14 1.93667 14.3617 3.75667 15.085 5.46C15.8317 7.16333 16.835 8.645 18.095 9.905C19.355 11.165 20.8367 12.1683 22.54 12.915C24.2433 13.6383 26.0633 14 28 14C26.0633 14 24.2433 14.3733 22.54 15.12C20.8367 15.8433 19.355 16.835 18.095 18.095C16.835 19.355 15.8317 20.8367 15.085 22.54C14.3617 24.2433 14 26.0633 14 28Z" fill="url(#gemini_grad)"/>
                  <defs>
                    <linearGradient id="gemini_grad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#1aa3ff"/>
                      <stop offset="100%" stopColor="#a259ff"/>
                    </linearGradient>
                  </defs>
                </svg>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Script Reel con Gemini</div>
                  <div style={{ color: '#4a5270', fontSize: '0.68rem', marginTop: 1 }}>{geminiArticle.titolo}</div>
                </div>
              </div>
              <button onClick={closeGeminiModal} style={{ background: 'none', border: 'none', color: '#4a5270', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <div style={{ padding: 18, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Step 1 */}
              <div style={{ background: '#0b0d17', border: '1px solid #1e2540', borderRadius: 10, padding: 14 }}>
                <div style={{ color: '#8892b0', fontSize: '0.75rem', fontWeight: 700, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>① Copia il prompt</span>
                  {extractLoading && <Loader2 size={13} className="animate-spin" style={{ color: '#5b7cf6' }} />}
                </div>
                <pre style={{ color: '#c8d0e8', fontSize: '0.72rem', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto', lineHeight: 1.55, wordBreak: 'break-word' }}>
                  {extractLoading ? 'Estrazione in corso...' : buildPrompt(geminiArticle.titolo, geminiArticle.url, extractedText)}
                </pre>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={copyPrompt} disabled={extractLoading} style={{ ...S.btnPrimary, padding: '6px 14px', fontSize: '0.77rem' }}>
                    <Copy size={12} /> Copia prompt
                  </button>
                  <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer"
                    style={{ background: '#1a73e8', color: '#fff', borderRadius: 7, padding: '6px 14px', fontSize: '0.77rem', fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
                    Apri Gemini <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ background: '#0b0d17', border: '1px solid #1e2540', borderRadius: 10, padding: 14 }}>
                <div style={{ color: '#8892b0', fontSize: '0.75rem', fontWeight: 700, marginBottom: 8 }}>② Incolla lo script generato</div>
                <textarea value={reelTesto} onChange={e => setReelTesto(e.target.value)}
                  placeholder="Incolla qui lo script del Reel..."
                  style={{ width: '100%', minHeight: 140, background: '#0f1220', border: '1px solid #252d4a', color: '#eef0f8', borderRadius: 8, padding: 11, fontSize: '0.83rem', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }} />
              </div>
            </div>

            <div style={{ padding: '13px 18px', borderTop: '1px solid #1e2540', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
              <button onClick={closeGeminiModal} style={{ ...S.btnGhost }}>Annulla</button>
              <button onClick={saveReel} disabled={!reelTesto.trim() || saving} style={{ ...S.btnPrimary, opacity: reelTesto.trim() ? 1 : 0.5, cursor: reelTesto.trim() ? 'pointer' : 'not-allowed' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Salva script
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL MODIFICA */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
          <div style={{ ...S.surface, borderRadius: 14, width: '100%', maxWidth: 600, boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e2540', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Modifica script</span>
              <button onClick={() => setEditModal(null)} style={{ background: 'none', border: 'none', color: '#4a5270', cursor: 'pointer' }}><X size={17} /></button>
            </div>
            <div style={{ padding: 18 }}>
              <textarea value={editText} onChange={e => setEditText(e.target.value)}
                style={{ width: '100%', minHeight: 220, background: '#0b0d17', border: '1px solid #252d4a', color: '#eef0f8', borderRadius: 8, padding: 12, fontSize: '0.84rem', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box', fontFamily: 'DM Sans, sans-serif' }} />
            </div>
            <div style={{ padding: '13px 18px', borderTop: '1px solid #1e2540', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
              <button onClick={() => setEditModal(null)} style={{ ...S.btnGhost }}>Annulla</button>
              <button onClick={saveEdit} style={{ ...S.btnPrimary }}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL AGGIUNGI */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
          <div style={{ ...S.surface, borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e2540', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Aggiungi scheda</span>
              <button onClick={() => setAddModal(false)} style={{ background: 'none', border: 'none', color: '#4a5270', cursor: 'pointer' }}><X size={17} /></button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[['Titolo *', 'titolo', 'Titolo articolo o contenuto...', 'text'],
                ['URL *',   'url',    'https://...', 'url'],
                ['Fonte',   'fonte',  'Es: Wired, HackerNews...', 'text']
              ].map(([label, key, ph, type]) => (
                <div key={key}>
                  <label style={{ color: '#8892b0', fontSize: '0.72rem', fontWeight: 700, display: 'block', marginBottom: 5 }}>{label}</label>
                  <input type={type} value={newCard[key]} onChange={e => setNewCard(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={ph} style={{ ...S.input }} />
                </div>
              ))}
            </div>
            <div style={{ padding: '13px 18px', borderTop: '1px solid #1e2540', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
              <button onClick={() => setAddModal(false)} style={{ ...S.btnGhost }}>Annulla</button>
              <button onClick={aggiungiScheda} disabled={!newCard.titolo || !newCard.url || addLoading} style={{ ...S.btnPrimary, opacity: newCard.titolo && newCard.url ? 1 : 0.5 }}>
                {addLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Aggiungi
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

/* ── CARD ── */
function Card({ articolo: a, expanded, onExpand, onGemini, onPubblica, onAnnulla, onEdit, onCopy, onElimina }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#0f1220',
        border: '1px solid ' + (hover ? '#252d4a' : '#1e2540'),
        borderRadius: 14, padding: 16,
        display: 'flex', flexDirection: 'column', gap: 9,
        transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 8px 28px rgba(0,0,0,0.3)' : 'none',
        position: 'relative'
      }}>

      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <StatusBadge status={a.status} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#2d3a58', fontSize: '0.63rem', fontFamily: 'JetBrains Mono, monospace' }}>{a.dataInvio}</span>
          {/* Pulsante elimina */}
          <button onClick={onElimina} title="Elimina scheda"
            style={{ background: 'none', border: 'none', color: '#2d3a58', cursor: 'pointer', padding: '2px 3px', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f56565'}
            onMouseLeave={e => e.currentTarget.style.color = '#2d3a58'}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Titolo */}
      <div style={{ color: '#eef0f8', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.4, letterSpacing: '-0.01em' }}>
        {a.titolo}
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#4a5270', fontSize: '0.75rem' }}>{a.fonte}</span>
        {a.url && (
          <a href={a.url} target="_blank" rel="noopener noreferrer"
            style={{ color: '#5b7cf6', fontSize: '0.75rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            Articolo <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* Testo elaborato */}
      {a.testoElaborato && (
        <div style={{ background: '#0b0d17', border: '1px solid #1e2540', borderRadius: 8, padding: 10 }}>
          <div style={{ color: '#c8d0e8', fontSize: '0.78rem', lineHeight: 1.55, overflow: 'hidden', maxHeight: expanded ? 'none' : 68 }}>
            {a.testoElaborato}
          </div>
          {a.testoElaborato.length > 160 && (
            <button onClick={onExpand} style={{ color: '#5b7cf6', fontSize: '0.72rem', background: 'none', border: 'none', cursor: 'pointer', marginTop: 5, padding: 0, fontFamily: 'DM Sans, sans-serif' }}>
              {expanded ? 'Mostra meno ↑' : 'Leggi tutto ↓'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button onClick={onEdit} style={{ color: '#4a5270', fontSize: '0.72rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'DM Sans, sans-serif' }}>
              <Edit size={11} /> Modifica
            </button>
            <button onClick={onCopy} style={{ color: '#4a5270', fontSize: '0.72rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'DM Sans, sans-serif' }}>
              <Copy size={11} /> Copia
            </button>
          </div>
        </div>
      )}

      {/* Azioni */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #1e2540' }}>
        {/* Pulsante Gemini — pulito, no gradiente */}
        <button onClick={onGemini} style={{
          background: '#141828', border: '1px solid #252d4a',
          color: '#eef0f8', borderRadius: 8, padding: '9px 0', fontWeight: 700,
          fontSize: '0.82rem', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'border-color 0.15s, background 0.15s', width: '100%'
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#5b7cf6'; e.currentTarget.style.background = '#1a2035' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#252d4a'; e.currentTarget.style.background = '#141828' }}>
          {/* Logo Gemini SVG */}
          <svg width="16" height="16" viewBox="0 0 28 28" fill="none">
            <path d="M14 28C14 26.0633 13.6267 24.2433 12.88 22.54C12.1567 20.8367 11.165 19.355 9.905 18.095C8.645 16.835 7.16333 15.8433 5.46 15.12C3.75667 14.3733 1.93667 14 0 14C1.93667 14 3.75667 13.6383 5.46 12.915C7.16333 12.1683 8.645 11.165 9.905 9.905C11.165 8.645 12.1567 7.16333 12.88 5.46C13.6267 3.75667 14 1.93667 14 0C14 1.93667 14.3617 3.75667 15.085 5.46C15.8317 7.16333 16.835 8.645 18.095 9.905C19.355 11.165 20.8367 12.1683 22.54 12.915C24.2433 13.6383 26.0633 14 28 14C26.0633 14 24.2433 14.3733 22.54 15.12C20.8367 15.8433 19.355 16.835 18.095 18.095C16.835 19.355 15.8317 20.8367 15.085 22.54C14.3617 24.2433 14 26.0633 14 28Z" fill="url(#g2)"/>
            <defs><linearGradient id="g2" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#1aa3ff"/><stop offset="100%" stopColor="#a259ff"/></linearGradient></defs>
          </svg>
          Genera script con Gemini
        </button>

        {a.status === 'Elaborato' && (
          <button onClick={onPubblica} style={{
            background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
            color: '#a78bfa', borderRadius: 8, padding: '7px 0', fontWeight: 600,
            fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 6, width: '100%', fontFamily: 'DM Sans, sans-serif'
          }}>
            <CheckCircle size={13} /> Segna come Pubblicato
          </button>
        )}
        {a.status === 'Pubblicato' && (
          <button onClick={onAnnulla} style={{
            background: 'none', border: 'none', color: '#2d3a58',
            fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif'
          }}>
            Annulla pubblicazione
          </button>
        )}
      </div>
    </div>
  )
}
