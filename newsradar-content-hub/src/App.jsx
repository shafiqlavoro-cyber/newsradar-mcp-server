import { useState, useEffect } from 'react'
import axios from 'axios'
import { ExternalLink, Edit, CheckCircle, Copy, Search, Loader2, Plus, X, RefreshCw } from 'lucide-react'

const API_BASE = 'https://newsradar-mcp-server.onrender.com'
const NEWSRADAR_URL = 'https://newsradar-d433a.web.app'

const REEL_PROMPT = (titolo, url, testo) => `Sei un esperto di comunicazione digitale per imprenditori.
Leggi la notizia qui sotto e scrivi uno script per un Reel Instagram.

REGOLE FONDAMENTALI:
- Scrivi SOLO il testo da dire nel video, niente didascalie o note di regia
- Tono diretto, concreto, da imprenditore a imprenditore
- Filtra il gergo tecnico e traducilo in impatto pratico per chi ha un'azienda
- La domanda guida è sempre: "cosa significa concretamente per te che hai un'azienda?"
- Durata: 30-45 secondi di parlato (circa 80-110 parole)
- Struttura obbligatoria:
  1. GANCIO (5 sec) — una frase che ferma lo scroll, inizia con un fatto o una domanda scomoda
  2. CONTESTO (10 sec) — spiega il fatto in modo semplice, zero gergo
  3. IMPATTO PRATICO (20 sec) — cosa cambia concretamente per un imprenditore italiano oggi
  4. CHIUSURA (5 sec) — una frase ad effetto o una domanda che invita a riflettere

NOTIZIA:
Titolo: ${titolo}
URL: ${url}
${testo ? `Testo estratto: ${testo}` : ''}

Scrivi solo lo script, senza titoli di sezione o parentesi. Testo fluido come se stessi parlando.`

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-800 border border-gray-600 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-3">
      <CheckCircle size={16} className="text-green-400" />
      {message}
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    'Da elaborare':  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'In lavorazione':'bg-blue-500/20 text-blue-400 border-blue-500/30',
    'Elaborato':     'bg-green-500/20 text-green-400 border-green-500/30',
    'Pubblicato':    'bg-purple-500/20 text-purple-400 border-purple-500/30',
  }
  return (
    <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${map[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {status}
    </span>
  )
}

export default function App() {
  const [articoli, setArticoli]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [filter, setFilter]           = useState('Tutti')
  const [search, setSearch]           = useState('')
  const [toast, setToast]             = useState(null)
  const [expanded, setExpanded]       = useState({})

  // Modal Gemini
  const [geminiArticle, setGeminiArticle]   = useState(null)
  const [extractedText, setExtractedText]   = useState('')
  const [extractLoading, setExtractLoading] = useState(false)
  const [reelTesto, setReelTesto]           = useState('')
  const [saving, setSaving]                 = useState(false)

  // Modal modifica testo
  const [editModal, setEditModal]   = useState(null)
  const [editText, setEditText]     = useState('')

  // Modal aggiungi scheda manuale
  const [addModal, setAddModal]     = useState(false)
  const [newCard, setNewCard]       = useState({ titolo: '', url: '', fonte: '' })
  const [addLoading, setAddLoading] = useState(false)

  const showToast = (msg) => setToast(msg)

  useEffect(() => { fetchArticoli() }, [])

  /* ── FETCH ── */
  const fetchArticoli = async () => {
    setLoading(true); setError(null)
    try {
      const res = await axios.get(`${API_BASE}/hub/articoli`)
      if (res.data.ok) setArticoli(res.data.articoli.reverse())
      else setError(res.data.error || 'Errore caricamento')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  /* ── STATUS UPDATE ── */
  const updateStatus = async (riga, status) => {
    setArticoli(prev => prev.map(a => a.riga === riga ? { ...a, status } : a))
    try { await axios.patch(`${API_BASE}/hub/articoli/${riga}`, { status }) }
    catch (e) { showToast('Errore aggiornamento status'); fetchArticoli() }
  }

  /* ── SALVA REEL ── */
  const saveReel = async () => {
    if (!geminiArticle || !reelTesto.trim()) return
    setSaving(true)
    try {
      await axios.patch(`${API_BASE}/hub/articoli/${geminiArticle.riga}`, {
        status: 'Elaborato',
        testo:  reelTesto
      })
      setArticoli(prev => prev.map(a =>
        a.riga === geminiArticle.riga ? { ...a, status: 'Elaborato', testoElaborato: reelTesto } : a
      ))
      closeGeminiModal()
      showToast('✅ Script Reel salvato!')
    } catch (e) { showToast('Errore salvataggio') }
    finally { setSaving(false) }
  }

  /* ── SALVA MODIFICA ── */
  const saveEdit = async () => {
    if (!editModal) return
    try {
      await axios.patch(`${API_BASE}/hub/articoli/${editModal.riga}`, { testo: editText })
      setArticoli(prev => prev.map(a => a.riga === editModal.riga ? { ...a, testoElaborato: editText } : a))
      setEditModal(null)
      showToast('✅ Testo aggiornato!')
    } catch (e) { showToast('Errore salvataggio') }
  }

  /* ── AGGIUNGI SCHEDA MANUALE ── */
  const aggiungiScheda = async () => {
    if (!newCard.titolo.trim() || !newCard.url.trim()) return
    setAddLoading(true)
    try {
      await axios.post(`${API_BASE}/hub/aggiungi`, newCard)
      setAddModal(false)
      setNewCard({ titolo: '', url: '', fonte: '' })
      showToast('✅ Scheda aggiunta!')
      fetchArticoli()
    } catch (e) { showToast('Errore aggiunta scheda') }
    finally { setAddLoading(false) }
  }

  /* ── GEMINI MODAL ── */
  const openGeminiModal = async (articolo) => {
    setGeminiArticle(articolo)
    setReelTesto('')
    setExtractedText('')
    if (articolo.status === 'Da elaborare') updateStatus(articolo.riga, 'In lavorazione')
    setExtractLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/hub/estrai?url=${encodeURIComponent(articolo.url)}`)
      if (res.data.ok) setExtractedText(res.data.testo)
    } catch {}
    finally { setExtractLoading(false) }
  }

  const closeGeminiModal = () => { setGeminiArticle(null); setExtractedText(''); setReelTesto('') }

  const copyPrompt = () => {
    if (!geminiArticle) return
    navigator.clipboard.writeText(REEL_PROMPT(geminiArticle.titolo, geminiArticle.url, extractedText))
    showToast('📋 Prompt copiato!')
  }

  /* ── FILTERED ── */
  const filtered = articoli.filter(a => {
    const okStatus = filter === 'Tutti' || a.status === filter
    const okSearch = a.titolo.toLowerCase().includes(search.toLowerCase())
    return okStatus && okSearch
  })

  const counts = {
    'Tutti':         articoli.length,
    'Da elaborare':  articoli.filter(a => a.status === 'Da elaborare').length,
    'Elaborato':     articoli.filter(a => a.status === 'Elaborato').length,
    'Pubblicato':    articoli.filter(a => a.status === 'Pubblicato').length,
  }

  return (
    <div className="min-h-screen" style={{ background: '#0a0c12', fontFamily: "'Inter', sans-serif" }}>

      {/* ── HEADER ── */}
      <header style={{ background: '#0d1017', borderBottom: '1px solid #1e2340' }} className="sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📡</div>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>NewsRadar <span style={{ color: '#7c3aed' }}>Hub</span></div>
              <div style={{ color: '#6b7280', fontSize: '0.7rem' }}>Pannello editoriale Reel Instagram</div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <a href={NEWSRADAR_URL} target="_blank" rel="noopener noreferrer"
               style={{ background: '#1e2340', border: '1px solid #2d3561', color: '#9ca3af', borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              ← NewsRadar <ExternalLink size={12} />
            </a>
            <button onClick={fetchArticoli} style={{ background: '#1e2340', border: '1px solid #2d3561', color: '#9ca3af', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
              <RefreshCw size={14} />
            </button>
            <button onClick={() => setAddModal(true)}
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={16} /> Aggiungi scheda
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* ── TOOLBAR ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#6b7280' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Cerca per titolo..."
              style={{ background: '#111420', border: '1px solid #1e2340', color: '#fff', borderRadius: 8, padding: '8px 12px 8px 36px', width: '100%', outline: 'none', fontSize: '0.875rem' }} />
          </div>
          <div style={{ display: 'flex', background: '#111420', border: '1px solid #1e2340', borderRadius: 8, overflow: 'hidden' }}>
            {Object.entries(counts).map(([f, n]) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                  background: filter === f ? '#7c3aed' : 'transparent',
                  color: filter === f ? '#fff' : '#9ca3af' }}>
                {f} <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({n})</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── CONTENT ── */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
            <Loader2 className="animate-spin" size={40} style={{ color: '#7c3aed' }} />
          </div>
        ) : error ? (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: 16, borderRadius: 10 }}>{error}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
            {filtered.map(a => (
              <Card key={a.riga} articolo={a}
                expanded={expanded[a.riga]}
                onExpand={() => setExpanded(p => ({ ...p, [a.riga]: !p[a.riga] }))}
                onGemini={() => openGeminiModal(a)}
                onPubblica={() => updateStatus(a.riga, 'Pubblicato')}
                onAnnulla={() => updateStatus(a.riga, 'Elaborato')}
                onEdit={() => { setEditModal(a); setEditText(a.testoElaborato || '') }}
                onCopy={() => { navigator.clipboard.writeText(a.testoElaborato || ''); showToast('📋 Copiato!') }}
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#6b7280', padding: 60 }}>
                Nessuna scheda trovata.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MODAL GEMINI ── */}
      {geminiArticle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
          <div style={{ background: '#111420', border: '1px solid #2d3561', borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.6)' }}>
            {/* header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2340', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                📸
                </div>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>Script Reel Instagram</div>
                  <div style={{ color: '#6b7280', fontSize: '0.72rem' }}>{geminiArticle.titolo}</div>
                </div>
              </div>
              <button onClick={closeGeminiModal} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Step 1 — prompt */}
              <div style={{ background: '#0d1017', border: '1px solid #1e2340', borderRadius: 10, padding: 14 }}>
                <div style={{ color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>① Copia il prompt per Gemini</span>
                  {extractLoading && <Loader2 size={14} className="animate-spin" style={{ color: '#7c3aed' }} />}
                </div>
                <pre style={{ color: '#d1d5db', fontSize: '0.75rem', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto', lineHeight: 1.5 }}>
                  {extractLoading ? 'Estrazione testo in corso...' : REEL_PROMPT(geminiArticle.titolo, geminiArticle.url, extractedText)}
                </pre>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={copyPrompt} disabled={extractLoading}
                    style={{ background: '#7c3aed', border: 'none', color: '#fff', borderRadius: 7, padding: '7px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Copy size={13} /> Copia prompt
                  </button>
                  <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer"
                    style={{ background: '#1a73e8', color: '#fff', borderRadius: 7, padding: '7px 16px', fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Apri Gemini <ExternalLink size={13} />
                  </a>
                </div>
              </div>

              {/* Step 2 — incolla risultato */}
              <div style={{ background: '#0d1017', border: '1px solid #1e2340', borderRadius: 10, padding: 14 }}>
                <div style={{ color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>② Incolla lo script generato da Gemini</div>
                <textarea value={reelTesto} onChange={e => setReelTesto(e.target.value)}
                  placeholder="Incolla qui lo script del Reel..."
                  style={{ width: '100%', minHeight: 160, background: '#111420', border: '1px solid #2d3561', color: '#fff', borderRadius: 8, padding: 12, fontSize: '0.85rem', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid #1e2340', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={closeGeminiModal} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '8px 14px', fontSize: '0.85rem' }}>Annulla</button>
              <button onClick={saveReel} disabled={!reelTesto.trim() || saving}
                style={{ background: reelTesto.trim() ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#2d3561', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600, cursor: reelTesto.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7 }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                Salva script
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL MODIFICA ── */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
          <div style={{ background: '#111420', border: '1px solid #2d3561', borderRadius: 16, width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2340', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontWeight: 700 }}>Modifica script</span>
              <button onClick={() => setEditModal(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div style={{ padding: 20 }}>
              <textarea value={editText} onChange={e => setEditText(e.target.value)}
                style={{ width: '100%', minHeight: 240, background: '#0d1017', border: '1px solid #2d3561', color: '#fff', borderRadius: 8, padding: 12, fontSize: '0.85rem', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }} />
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #1e2340', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setEditModal(null)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '8px 14px' }}>Annulla</button>
              <button onClick={saveEdit} style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL AGGIUNGI ── */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
          <div style={{ background: '#111420', border: '1px solid #2d3561', borderRadius: 16, width: '100%', maxWidth: 480, boxShadow: '0 25px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e2340', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontWeight: 700 }}>Aggiungi scheda manualmente</span>
              <button onClick={() => setAddModal(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[['Titolo *', 'titolo', 'Titolo dell\'articolo o contenuto...'], ['URL *', 'url', 'https://...'], ['Fonte', 'fonte', 'Es: Wired, TechCrunch, HackerNews...']].map(([label, key, ph]) => (
                <div key={key}>
                  <label style={{ color: '#9ca3af', fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>{label}</label>
                  <input value={newCard[key]} onChange={e => setNewCard(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={ph}
                    style={{ width: '100%', background: '#0d1017', border: '1px solid #2d3561', color: '#fff', borderRadius: 8, padding: '9px 12px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              ))}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #1e2340', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setAddModal(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '8px 14px' }}>Annulla</button>
              <button onClick={aggiungiScheda} disabled={!newCard.titolo.trim() || !newCard.url.trim() || addLoading}
                style={{ background: newCard.titolo && newCard.url ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#2d3561', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                {addLoading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
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

function Card({ articolo: a, expanded, onExpand, onGemini, onPubblica, onAnnulla, onEdit, onCopy }) {
  return (
    <div style={{ background: '#111420', border: '1px solid #1e2340', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#2d3561'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#1e2340'}>

      {/* top row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <StatusBadge status={a.status} />
        <span style={{ color: '#4b5563', fontSize: '0.68rem' }}>{a.dataInvio}</span>
      </div>

      {/* title */}
      <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.4 }}>{a.titolo}</div>

      {/* meta */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>{a.fonte}</span>
        {a.url && (
          <a href={a.url} target="_blank" rel="noopener noreferrer"
            style={{ color: '#7c3aed', fontSize: '0.78rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            Articolo <ExternalLink size={12} />
          </a>
        )}
      </div>

      {/* testo elaborato */}
      {a.testoElaborato && (
        <div style={{ background: '#0d1017', border: '1px solid #1e2340', borderRadius: 8, padding: 10 }}>
          <div style={{ color: '#d1d5db', fontSize: '0.8rem', lineHeight: 1.6, overflow: 'hidden', maxHeight: expanded ? 'none' : 72, transition: 'max-height 0.3s' }}>
            {a.testoElaborato}
          </div>
          {a.testoElaborato.length > 200 && (
            <button onClick={onExpand} style={{ color: '#7c3aed', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4, padding: 0 }}>
              {expanded ? 'Mostra meno ↑' : 'Leggi tutto ↓'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={onEdit} style={{ color: '#9ca3af', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Edit size={12} /> Modifica
            </button>
            <button onClick={onCopy} style={{ color: '#9ca3af', fontSize: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Copy size={12} /> Copia
            </button>
          </div>
        </div>
      )}

      {/* actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #1e2340' }}>
        <button onClick={onGemini}
          style={{ background: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)', border: 'none', color: '#fff', borderRadius: 8, padding: '9px 0', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          📸 Script Reel con Gemini
        </button>
        {a.status === 'Elaborato' && (
          <button onClick={onPubblica}
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', borderRadius: 8, padding: '7px 0', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <CheckCircle size={14} /> Segna come Pubblicato
          </button>
        )}
        {a.status === 'Pubblicato' && (
          <button onClick={onAnnulla}
            style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: '0.75rem', cursor: 'pointer' }}>
            Annulla pubblicazione
          </button>
        )}
      </div>
    </div>
  )
}
