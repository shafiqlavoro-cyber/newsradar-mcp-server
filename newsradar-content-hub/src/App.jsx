import { useState, useEffect } from 'react'
import axios from 'axios'
import { ExternalLink, Edit, CheckCircle, Copy, Search, Loader2 } from 'lucide-react'

// Use the production server URL as requested
const API_BASE = 'https://newsradar-mcp-server.onrender.com'

function App() {
  const [articoli, setArticoli] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [filter, setFilter] = useState('Tutti')
  const [search, setSearch] = useState('')

  const [selectedArticle, setSelectedArticle] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [extractedText, setExtractedText] = useState('')
  const [modalLoading, setModalLoading] = useState(false)
  const [elaboratoTesto, setElaboratoTesto] = useState('')

  const [editMode, setEditMode] = useState(null)
  const [editText, setEditText] = useState('')

  useEffect(() => {
    fetchArticoli()
  }, [])

  const fetchArticoli = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await axios.get(`${API_BASE}/hub/articoli`)
      if (res.data.ok) {
        setArticoli(res.data.articoli.reverse()) // Show newest first
      } else {
        setError(res.data.error || 'Errore nel caricamento articoli')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (riga, newStatus) => {
    // Optimistic update
    const prevArticoli = [...articoli]
    setArticoli(articoli.map(a => a.riga === riga ? { ...a, status: newStatus } : a))

    try {
      await axios.patch(`${API_BASE}/hub/articoli/${riga}`, { status: newStatus })
    } catch (err) {
      // Revert on error
      setArticoli(prevArticoli)
      alert('Errore nell\'aggiornamento dello status: ' + err.message)
    }
  }

  const saveElaborato = async () => {
    if (!selectedArticle) return

    setModalLoading(true)
    try {
      await axios.patch(`${API_BASE}/hub/articoli/${selectedArticle.riga}`, {
        status: 'Elaborato',
        testo: elaboratoTesto
      })

      // Update local state
      setArticoli(articoli.map(a =>
        a.riga === selectedArticle.riga
          ? { ...a, status: 'Elaborato', testoElaborato: elaboratoTesto }
          : a
      ))

      closeModal()
    } catch (err) {
      alert('Errore nel salvataggio: ' + err.message)
    } finally {
      setModalLoading(false)
    }
  }

  const saveEditedText = async (riga) => {
    try {
      await axios.patch(`${API_BASE}/hub/articoli/${riga}`, {
        testo: editText
      })

      setArticoli(articoli.map(a =>
        a.riga === riga ? { ...a, testoElaborato: editText } : a
      ))

      setEditMode(null)
    } catch (err) {
      alert('Errore nel salvataggio: ' + err.message)
    }
  }

  const openGeminiModal = async (articolo) => {
    setSelectedArticle(articolo)
    setIsModalOpen(true)
    setExtractedText('')
    setElaboratoTesto('')
    setModalLoading(true)

    // Update status to "In lavorazione" if it's "Da elaborare"
    if (articolo.status === 'Da elaborare') {
      updateStatus(articolo.riga, 'In lavorazione')
    }

    try {
      const res = await axios.get(`${API_BASE}/hub/estrai?url=${encodeURIComponent(articolo.url)}`)
      if (res.data.ok) {
        setExtractedText(res.data.testo)
      } else {
        setExtractedText('Errore estrazione: ' + res.data.error)
      }
    } catch (err) {
      setExtractedText('Errore connessione per estrazione: ' + err.message)
    } finally {
      setModalLoading(false)
    }
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setSelectedArticle(null)
    setExtractedText('')
    setElaboratoTesto('')
  }

  const getGeminiPrompt = () => {
    if (!selectedArticle) return ''

    return `Ti passo una notizia con titolo, URL e testo estratto.
Segui queste fasi nell'ordine.

FASE 1 — Valuta il contenuto
Leggi il testo estratto fornito. Se è insufficiente (meno di 150 parole utili),
comunicamelo e non procedere.

FASE 2 — Estrai tutto il contenuto utile
Individua ogni informazione presente:
- Fatti principali (chi, cosa, quando, dove, perché, come)
- Numeri, statistiche, percentuali, date
- Dichiarazioni di persone o istituzioni
- Cause, conseguenze, contesto storico o geografico
- Concetti tecnici o termini specifici
- Eventuali sviluppi futuri menzionati

FASE 3 — Scegli il tono giusto
Scegli autonomamente tra:
- Narrativo/storytelling — storie umane, fatti con arco narrativo
- Tecnico/scientifico — scoperte, ricerche, tecnologia, salute
- Urgente/allerta — crisi, emergenze, rischi imminenti
- Leggero/curioso — notizie insolite, curiosità, cultura
- Economico/finanziario — mercati, aziende, politiche economiche

FASE 4 — Scrivi il titolo
- Affermazione, non domanda
- Specifico e diretto
- Max 12 parole

FASE 5 — Scrivi l'articolo
- In italiano, linguaggio chiaro
- Non citare mai la fonte o l'URL
- Non copiare frasi dall'originale
- Testo fluido in paragrafi, senza elenchi puntati o grassetti casuali
- Struttura: apertura → sviluppo → chiusura

NOTIZIA DA ELABORARE:
Titolo: ${selectedArticle.titolo}
URL: ${selectedArticle.url}
Testo: ${extractedText}`
  }

  const copyPrompt = () => {
    navigator.clipboard.writeText(getGeminiPrompt())
    alert('Prompt copiato negli appunti!')
  }

  const copyText = (text) => {
    navigator.clipboard.writeText(text)
    alert('Testo copiato negli appunti!')
  }

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Da elaborare': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      case 'In lavorazione': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      case 'Elaborato': return 'bg-green-500/20 text-green-400 border-green-500/30'
      case 'Pubblicato': return 'bg-primary/20 text-primary border-primary/30'
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    }
  }

  const filteredArticoli = articoli.filter(a => {
    const matchStatus = filter === 'Tutti' || a.status === filter
    const matchSearch = a.titolo.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">NewsRadar Content Hub</h1>
          <p className="text-gray-400">Pannello editoriale per elaborazione articoli</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Cerca per titolo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-surface border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-primary w-full"
            />
          </div>

          <div className="flex bg-surface border border-gray-700 rounded-lg overflow-hidden">
            {['Tutti', 'Da elaborare', 'Elaborato', 'Pubblicato'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${filter === f ? 'bg-primary text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="animate-spin text-primary" size={48} />
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredArticoli.map(articolo => (
            <div key={articolo.riga} className="bg-surface border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors flex flex-col">
              <div className="flex justify-between items-start mb-3">
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${getStatusBadgeClass(articolo.status)}`}>
                  {articolo.status}
                </span>
                <span className="text-xs text-gray-500">{articolo.dataInvio}</span>
              </div>

              <h3 className="text-lg font-bold text-white mb-2 leading-tight">
                {articolo.titolo}
              </h3>

              <div className="text-sm text-gray-400 mb-4 flex items-center justify-between">
                <span>{articolo.fonte}</span>
                <a href={articolo.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 flex items-center gap-1">
                  Originale <ExternalLink size={14} />
                </a>
              </div>

              {articolo.testoElaborato && (
                <div className="mt-auto mb-4 bg-gray-900/50 rounded-lg p-3 text-sm text-gray-300 border border-gray-800">
                  {editMode === articolo.riga ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        className="w-full h-32 bg-gray-800 text-white rounded p-2 focus:outline-none focus:ring-1 focus:ring-primary"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditMode(null)}
                          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white"
                        >
                          Annulla
                        </button>
                        <button
                          onClick={() => saveEditedText(articolo.riga)}
                          className="px-2 py-1 text-xs bg-primary hover:bg-primary/90 rounded text-white"
                        >
                          Salva
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="line-clamp-3 mb-2">{articolo.testoElaborato}</div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditMode(articolo.riga)
                            setEditText(articolo.testoElaborato)
                          }}
                          className="text-gray-400 hover:text-white flex items-center gap-1 text-xs"
                        >
                          <Edit size={12} /> Modifica
                        </button>
                        <button
                          onClick={() => copyText(articolo.testoElaborato)}
                          className="text-gray-400 hover:text-white flex items-center gap-1 text-xs"
                        >
                          <Copy size={12} /> Copia
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="mt-auto pt-4 border-t border-gray-800 flex flex-col gap-2">
                <button
                  onClick={() => openGeminiModal(articolo)}
                  className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-lg transition-colors flex justify-center items-center gap-2"
                >
                  <img src="https://www.gstatic.com/lamda/images/favicon_v1_150160cddff7f294ce30.svg" className="w-4 h-4" alt="Gemini" />
                  Apri con Gemini
                </button>

                {articolo.status === 'Elaborato' && (
                  <button
                    onClick={() => updateStatus(articolo.riga, 'Pubblicato')}
                    className="w-full py-2 bg-primary/10 hover:bg-primary/20 text-primary font-medium rounded-lg transition-colors flex justify-center items-center gap-2"
                  >
                    <CheckCircle size={16} /> Segna come Pubblicato
                  </button>
                )}

                {articolo.status === 'Pubblicato' && (
                  <button
                    onClick={() => updateStatus(articolo.riga, 'Elaborato')}
                    className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 font-medium transition-colors"
                  >
                    Annulla pubblicazione
                  </button>
                )}
              </div>
            </div>
          ))}

          {filteredArticoli.length === 0 && (
            <div className="col-span-full py-12 text-center text-gray-500">
              Nessun articolo trovato.
            </div>
          )}
        </div>
      )}

      {/* Gemini Modal */}
      {isModalOpen && selectedArticle && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface border border-gray-700 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-surface sticky top-0 rounded-t-xl z-10">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <img src="https://www.gstatic.com/lamda/images/favicon_v1_150160cddff7f294ce30.svg" className="w-5 h-5" alt="Gemini" />
                Elaborazione con Gemini
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-white p-1">
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
                <h3 className="font-semibold text-gray-300 mb-2">1. Copia questo prompt precompilato</h3>
                <div className="relative">
                  <pre className="bg-black/50 text-gray-300 p-4 rounded text-sm overflow-x-auto whitespace-pre-wrap max-h-60">
                    {modalLoading ? 'Estrazione testo in corso...' : getGeminiPrompt()}
                  </pre>
                  <button
                    onClick={copyPrompt}
                    disabled={modalLoading}
                    className="absolute top-2 right-2 p-2 bg-surface hover:bg-gray-700 rounded text-gray-300 transition-colors disabled:opacity-50"
                    title="Copia prompt"
                  >
                    <Copy size={16} />
                  </button>
                </div>
              </div>

              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
                <h3 className="font-semibold text-gray-300 mb-2">2. Apri Gemini e incolla il prompt</h3>
                <a
                  href="https://gemini.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg font-medium transition-colors"
                >
                  Apri Gemini in una nuova scheda <ExternalLink size={16} />
                </a>
              </div>

              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
                <h3 className="font-semibold text-gray-300 mb-2">3. Incolla qui il risultato</h3>
                <textarea
                  className="w-full h-48 bg-black/50 border border-gray-700 rounded-lg p-4 text-white focus:outline-none focus:border-primary resize-y"
                  placeholder="Incolla l'articolo generato da Gemini..."
                  value={elaboratoTesto}
                  onChange={e => setElaboratoTesto(e.target.value)}
                />
              </div>
            </div>

            <div className="p-4 border-t border-gray-800 bg-surface flex justify-end gap-3 rounded-b-xl sticky bottom-0">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-400 hover:text-white font-medium transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={saveElaborato}
                disabled={!elaboratoTesto.trim() || modalLoading}
                className="px-6 py-2 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {modalLoading ? <Loader2 className="animate-spin" size={18} /> : null}
                Salva testo elaborato
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
