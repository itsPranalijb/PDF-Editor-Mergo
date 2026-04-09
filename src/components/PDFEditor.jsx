import { useState, useRef, useCallback, useEffect } from 'react'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { useDropzone } from 'react-dropzone'
import PDFPageCanvas, { loadPdfJs } from './PDFPageCanvas'

const EDITOR_SCALE = 1.5
const THUMB_SCALE  = 0.32

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)/255
  const g = parseInt(hex.slice(3,5),16)/255
  const b = parseInt(hex.slice(5,7),16)/255
  return rgb(r,g,b)
}

/** Merge adjacent text items that are on the same line into word/phrase groups */
function groupTextItems(rawItems, vpHeight) {
  if (!rawItems.length) return []

  // Build extended items with canvas coords
  const ext = rawItems
    .filter(it => it.str && it.str.trim())
    .map(it => {
      const [a,b,,d,tx,ty] = it.transform
      const fs = Math.max(Math.hypot(a,b), 1)
      const pdfW = it.width > 0 ? it.width : fs * it.str.length * 0.55
      return {
        id: crypto.randomUUID(),
        str: it.str,
        pdfX: tx, pdfY: ty,
        pdfW,
        pdfFontSize: fs,
        cx: tx * EDITOR_SCALE,
        cy: vpHeight - (ty + fs) * EDITOR_SCALE,
        cw: Math.max(pdfW * EDITOR_SCALE, 8),
        ch: fs * EDITOR_SCALE * 1.35,
      }
    })
    .filter(it => it.ch > 2)

  // Sort by y (line), then x
  ext.sort((a,b) => {
    const dy = Math.abs(a.pdfY - b.pdfY)
    if (dy > a.pdfFontSize * 0.4) return b.pdfY - a.pdfY // higher y (PDF) = higher on page
    return a.pdfX - b.pdfX
  })

  const groups = []
  let cur = null

  for (const it of ext) {
    if (!cur) { cur = {...it, original: it.str, current: it.str}; continue }
    const sameY = Math.abs(it.pdfY - cur.pdfY) < cur.pdfFontSize * 0.55
    const gap   = it.pdfX - (cur.pdfX + cur.pdfW)
    const close = gap < cur.pdfFontSize * 2.5 && gap > -cur.pdfFontSize * 0.5

    if (sameY && close) {
      const space = gap > cur.pdfFontSize * 0.25 ? ' ' : ''
      cur.original += space + it.str
      cur.current  += space + it.str
      cur.pdfW   = (it.pdfX + it.pdfW) - cur.pdfX
      cur.cw     = Math.max(cur.pdfW * EDITOR_SCALE, 8)
    } else {
      groups.push(cur)
      cur = {...it, original: it.str, current: it.str}
    }
  }
  if (cur) groups.push(cur)
  return groups
}

// ─────────────────────────────────────────────────────────────────────────────
// Full-page modal: edits EXISTING text + lets you ADD new text
// ─────────────────────────────────────────────────────────────────────────────
function PageEditModal({ pdfDoc, pageNumber, savedData, onSave, onClose }) {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)
  const inputRefs    = useRef({})
  const dragRef      = useRef(null)

  const [textItems,  setTextItems]  = useState([])          // extracted from PDF
  const [addedItems, setAddedItems] = useState(savedData?.addedItems || [])
  const [mode,       setMode]       = useState('edit')      // 'edit' | 'add'
  const [editingId,  setEditingId]  = useState(null)
  const [hoveredId,  setHoveredId]  = useState(null)
  const [addSelId,   setAddSelId]   = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [vpH,        setVpH]        = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [noText,     setNoText]     = useState(false)

  // ── render + extract ────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    setLoading(true)

    ;(async () => {
      const page = await pdfDoc.getPage(pageNumber)
      if (cancelled) return
      const vp = page.getViewport({ scale: EDITOR_SCALE })

      const cv = canvasRef.current
      if (!cv) return
      cv.width  = vp.width
      cv.height = vp.height
      setVpH(vp.height)

      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
      if (cancelled) return

      const tc = await page.getTextContent()
      if (cancelled) return

      const groups = groupTextItems(tc.items, vp.height)

      // Re-apply any previously saved edits (match by position+original)
      const prev = savedData?.textEdits || {}
      const withSaved = groups.map(g => {
        const key = stableKey(g)
        return { ...g, current: prev[key] ?? g.original }
      })

      setTextItems(withSaved)
      setNoText(groups.length === 0)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [pdfDoc, pageNumber])

  const stableKey = (g) => `${g.pdfX.toFixed(1)}|${g.pdfY.toFixed(1)}|${g.original}`

  // ── window drag ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return
      const { id, sx, sy, ix, iy } = dragRef.current
      setAddedItems(prev => prev.map(it =>
        it.id !== id ? it : { ...it, x: ix + e.clientX - sx, y: iy + e.clientY - sy }
      ))
    }
    const onUp = () => { dragRef.current = null; setIsDragging(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // ── auto-focus new added box ─────────────────────────────────────────────
  useEffect(() => {
    if (!addSelId) return
    const raf = requestAnimationFrame(() => { inputRefs.current[addSelId]?.focus() })
    return () => cancelAnimationFrame(raf)
  }, [addSelId, addedItems.length])

  // ── helpers ───────────────────────────────────────────────────────────────
  const updateTextItem = (id, val) =>
    setTextItems(prev => prev.map(it => it.id === id ? { ...it, current: val } : it))

  const updateAdded = (id, patch) =>
    setAddedItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))

  const removeAdded = (id) => {
    setAddedItems(prev => prev.filter(it => it.id !== id))
    if (addSelId === id) setAddSelId(null)
  }

  const handleCanvasClick = (e) => {
    if (mode !== 'add') return
    if (e.target !== containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const id   = crypto.randomUUID()
    setAddedItems(prev => [...prev, { id, x: e.clientX-rect.left, y: e.clientY-rect.top, text:'', fontSize:18, color:'#e53935' }])
    setAddSelId(id)
  }

  const startDrag = (e, item) => {
    e.stopPropagation(); e.preventDefault()
    setAddSelId(item.id)
    dragRef.current = { id: item.id, sx: e.clientX, sy: e.clientY, ix: item.x, iy: item.y }
    setIsDragging(true)
  }

  // ── save ─────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const textEdits = {}
    for (const it of textItems) {
      if (it.current !== it.original) textEdits[stableKey(it)] = it.current
    }
    onSave({ textEdits, addedItems, textItems })
    onClose()
  }

  const modifiedCount = textItems.filter(it => it.current !== it.original).length
  const totalChanges  = modifiedCount + addedItems.filter(it => it.text.trim()).length

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">

        {/* toolbar */}
        <div className="modal-toolbar">
          <span className="modal-title">✏️  Page {pageNumber}</span>

          <div className="modal-tools">
            <button className={`mtool-btn ${mode==='edit'?'mtool-btn--active':''}`} onClick={() => setMode('edit')}>
              ✏ Edit Text
            </button>
            <button className={`mtool-btn ${mode==='add'?'mtool-btn--active':''}`} onClick={() => setMode('add')}>
              ＋ Add Text
            </button>
            {totalChanges > 0 && (
              <span className="change-badge">{totalChanges} change{totalChanges>1?'s':''}</span>
            )}
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-save" onClick={handleSave}>✓ Save &amp; Close</button>
          </div>
        </div>

        <div className={`modal-hint ${mode==='edit'?'modal-hint--edit':'modal-hint--add'}`}>
          {mode === 'edit'
            ? '🖊  Click on any highlighted text to edit it directly on the page'
            : '✚  Click anywhere on the blank page area to place a new text box'}
        </div>

        <div className="modal-body">
          {/* canvas */}
          <div className="modal-canvas-scroll">
            {loading && <div className="modal-loading">⟳ Rendering…</div>}
            <div
              ref={containerRef}
              className="canvas-host"
              style={{
                display:'inline-block', position:'relative',
                cursor: mode==='add' ? 'crosshair' : isDragging ? 'grabbing' : 'default',
                opacity: loading ? 0 : 1,
                transition: 'opacity .3s',
              }}
              onClick={handleCanvasClick}
            >
              <canvas ref={canvasRef} style={{ display:'block', pointerEvents:'none', userSelect:'none' }} />

              {/* ── existing text hit-areas (edit mode) ── */}
              {mode === 'edit' && textItems.map(it => {
                const changed  = it.current !== it.original
                const editing  = editingId === it.id
                const hovered  = hoveredId === it.id
                return (
                  <div
                    key={it.id}
                    className={`text-hit ${hovered?'text-hit--hover':''} ${changed?'text-hit--changed':''} ${editing?'text-hit--editing':''}`}
                    style={{ left:it.cx, top:it.cy, width:Math.max(it.cw,10), height:Math.max(it.ch,14), position:'absolute' }}
                    onMouseEnter={() => setHoveredId(it.id)}
                    onMouseLeave={() => { setHoveredId(null) }}
                    onClick={e => { e.stopPropagation(); setEditingId(it.id) }}
                  >
                    {editing && (
                      <input
                        autoFocus
                        className="text-hit__input"
                        value={it.current}
                        onChange={e => updateTextItem(it.id, e.target.value)}
                        onBlur={() => setEditingId(null)}
                        onKeyDown={e => { if(e.key==='Escape'||e.key==='Enter') setEditingId(null) }}
                        style={{
                          fontSize: it.ch * 0.72,
                          width: Math.max(it.cw, 60),
                          fontFamily:'Helvetica,Arial,sans-serif',
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                  </div>
                )
              })}

              {/* ── added text boxes (add mode) ── */}
              {addedItems.map(it => (
                <div
                  key={it.id}
                  className={`tbox ${addSelId===it.id?'tbox--sel':''}`}
                  style={{ left:it.x, top:it.y, position:'absolute' }}
                  onClick={e => { e.stopPropagation(); setAddSelId(it.id) }}
                >
                  <div className="tbox__handle" onMouseDown={e => startDrag(e,it)}>⠿ drag</div>
                  <input
                    ref={el => { if(el) inputRefs.current[it.id]=el }}
                    className="tbox__input"
                    value={it.text}
                    onChange={e => updateAdded(it.id, {text:e.target.value})}
                    placeholder="Type here…"
                    style={{ fontSize:it.fontSize, color:it.color, fontFamily:'Helvetica,Arial,sans-serif' }}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                  />
                  {addSelId === it.id && (
                    <div className="tbox__controls" onClick={e => e.stopPropagation()}>
                      <label className="ctrl-label">Size
                        <input type="number" min="8" max="120" value={it.fontSize}
                          onChange={e => updateAdded(it.id,{fontSize:+e.target.value})}
                          onMouseDown={e=>e.stopPropagation()} className="ctrl-num"/>
                      </label>
                      <label className="ctrl-label">Color
                        <input type="color" value={it.color}
                          onChange={e => updateAdded(it.id,{color:e.target.value})}
                          onMouseDown={e=>e.stopPropagation()} className="ctrl-color"/>
                      </label>
                      <button className="ctrl-del" onClick={() => removeAdded(it.id)}>🗑</button>
                    </div>
                  )}
                </div>
              ))}

              {noText && mode==='edit' && !loading && (
                <div className="no-text-msg">No selectable text found.<br/>Switch to <strong>Add Text</strong> mode to overlay new text.</div>
              )}
            </div>
          </div>

          {/* sidebar */}
          <div className="modal-sidebar">
            <div className="sidebar-title">
              {mode==='edit' ? `Existing Text (${textItems.length})` : `Added Text (${addedItems.length})`}
            </div>

            {mode==='edit' && (
              <div className="sidebar-scroll">
                {textItems.length === 0 && !loading && (
                  <div className="sidebar-empty">No text extracted</div>
                )}
                {textItems.map((it,i) => (
                  <div key={it.id}
                    className={`srow ${editingId===it.id?'srow--active':''} ${it.current!==it.original?'srow--changed':''}`}
                    onClick={() => setEditingId(it.id)}
                  >
                    <span className="srow__num">{i+1}</span>
                    <div className="srow__content">
                      {it.current !== it.original && (
                        <span className="srow__old">{it.original}</span>
                      )}
                      <span className="srow__text">{it.current || <em style={{color:'#bbb'}}>empty</em>}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mode==='add' && (
              <div className="sidebar-scroll">
                {addedItems.length === 0 && (
                  <div className="sidebar-empty">Click the page to add text</div>
                )}
                {addedItems.map((it,i) => (
                  <div key={it.id}
                    className={`srow ${addSelId===it.id?'srow--active':''}`}
                    onClick={() => setAddSelId(it.id)}
                  >
                    <span className="srow__num">{i+1}</span>
                    <span className="srow__text" style={{color:it.color}}>{it.text||<em style={{color:'#bbb'}}>empty</em>}</span>
                    <button className="srow__del" onClick={e=>{e.stopPropagation();removeAdded(it.id)}}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main PDF Editor
// ─────────────────────────────────────────────────────────────────────────────
export default function PDFEditor() {
  const [pdfDoc,      setPdfDoc]      = useState(null)
  const [pageCount,   setPageCount]   = useState(0)
  const [removedPages,setRemovedPages]= useState(new Set())
  const [pageEdits,   setPageEdits]   = useState({})   // pageNum → { textEdits, addedItems, textItems }
  const [editingPage, setEditingPage] = useState(null)
  const [fileName,    setFileName]    = useState('')
  const [downloading, setDownloading] = useState(false)
  const rawBytesRef = useRef(null)

  const onDrop = useCallback(async (files) => {
    const file = files[0]; if (!file) return
    setFileName(file.name)
    setRemovedPages(new Set()); setPageEdits({}); setEditingPage(null)
    const ab = await file.arrayBuffer()
    rawBytesRef.current = ab.slice(0)
    const doc = await loadPdfJs(ab.slice(0))
    setPdfDoc(doc); setPageCount(doc.numPages)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept:{'application/pdf':['.pdf']}, multiple:false,
  })

  const toggleRemove = (n) => setRemovedPages(prev => {
    const s=new Set(prev); s.has(n)?s.delete(n):s.add(n); return s
  })

  const handleDownload = async () => {
    if (!rawBytesRef.current) return
    setDownloading(true)
    try {
      const doc  = await PDFDocument.load(rawBytesRef.current)
      const pages = doc.getPages()
      const font  = await doc.embedFont(StandardFonts.Helvetica)
      const fontB = await doc.embedFont(StandardFonts.HelveticaBold)

      for (const [numStr, data] of Object.entries(pageEdits)) {
        const n = parseInt(numStr)
        if (removedPages.has(n)) continue
        const page = pages[n-1]
        const { height } = page.getSize()

        // 1. Apply existing-text edits: whiteout + redraw
        for (const it of (data.textItems || [])) {
          if (it.current === it.original) continue
          // white rectangle over original text
          page.drawRectangle({
            x: it.pdfX - 1,
            y: it.pdfY - it.pdfFontSize * 0.28,
            width:  it.pdfW + 3,
            height: it.pdfFontSize * 1.35,
            color:  rgb(1,1,1),
          })
          // new text
          if (it.current.trim()) {
            page.drawText(it.current, {
              x:    it.pdfX,
              y:    it.pdfY,
              size: Math.max(it.pdfFontSize, 4),
              font, color: rgb(0,0,0),
            })
          }
        }

        // 2. Apply added (overlay) text
        for (const it of (data.addedItems || [])) {
          if (!it.text.trim()) continue
          page.drawText(it.text, {
            x:    Math.max(0, it.x / EDITOR_SCALE),
            y:    Math.max(0, height - it.y / EDITOR_SCALE - it.fontSize),
            size: it.fontSize,
            font: fontB,
            color: hexToRgb(it.color),
          })
        }
      }

      ;[...removedPages].map(p=>p-1).sort((a,b)=>b-a).forEach(i=>doc.removePage(i))

      const bytes = await doc.save()
      const url   = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))
      Object.assign(document.createElement('a'),{href:url,download:fileName.replace(/\.pdf$/i,'_edited.pdf')}).click()
      URL.revokeObjectURL(url)
    } finally { setDownloading(false) }
  }

  const allPages    = Array.from({length:pageCount},(_,i)=>i+1)
  const totalEdits  = Object.values(pageEdits).reduce((s,d)=>{
    const t = (d.textItems||[]).filter(it=>it.current!==it.original).length
    const a = (d.addedItems||[]).filter(it=>it.text.trim()).length
    return s+t+a
  }, 0)

  // ── landing (no PDF loaded) ────────────────────────────────────────────────
  if (!pdfDoc) {
    return (
      <div className="landing">
        <div className="landing__hero">
          <div className="landing__badge">Free · In-browser · No upload</div>
          <h2 className="landing__title">Edit PDF Content<br/><span>Directly in Your Browser</span></h2>
          <p className="landing__sub">
            Click on any existing text to edit it, remove pages, or overlay new text — then download instantly.
          </p>

          <div {...getRootProps()} className={`landing__drop ${isDragActive?'landing__drop--over':''}`}>
            <input {...getInputProps()} />
            <div className="landing__drop-icon">📄</div>
            <p className="landing__drop-title">{isDragActive ? 'Drop it!' : 'Drop your PDF here'}</p>
            <p className="landing__drop-sub">or click to browse your files</p>
          </div>
        </div>

        <div className="landing__features">
          {[
            { icon:'🖊', title:'Edit Existing Text', desc:'Click on any word or phrase in the PDF to edit it directly. Saves with whiteout + redraw.' },
            { icon:'✚', title:'Add New Text', desc:'Place custom text boxes anywhere on the page with custom font size and colour.' },
            { icon:'🗑', title:'Remove Pages', desc:'Exclude any pages from the output. Restore them with one click before downloading.' },
            { icon:'⬇', title:'Download Instantly', desc:'All processing happens in your browser. Your PDF never leaves your device.' },
          ].map(f => (
            <div key={f.title} className="feat-card">
              <div className="feat-card__icon">{f.icon}</div>
              <h3 className="feat-card__title">{f.title}</h3>
              <p className="feat-card__desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── editor view ────────────────────────────────────────────────────────────
  return (
    <div className="editor-root">
      <div className="ed-toolbar">
        <div className="ed-toolbar__left">
          <span className="ed-filename">📄 {fileName}</span>
          <div className="ed-stats">
            <span className="stat-chip">{pageCount} pages</span>
            {removedPages.size>0 && <span className="stat-chip stat-chip--red">{removedPages.size} removed</span>}
            {totalEdits>0        && <span className="stat-chip stat-chip--green">{totalEdits} edit{totalEdits>1?'s':''}</span>}
          </div>
        </div>
        <div className="ed-toolbar__right">
          <button className="btn btn-ghost" onClick={()=>{setPdfDoc(null);setPageCount(0)}}>← New PDF</button>
          <button className={`btn btn-download ${downloading?'btn-download--busy':''}`} onClick={handleDownload} disabled={downloading}>
            {downloading ? '⟳ Processing…' : '⬇ Download PDF'}
          </button>
        </div>
      </div>

      <p className="ed-hint">
        Click <strong>Edit</strong> to open a page editor and modify existing text · Click <strong>Remove</strong> to exclude a page
      </p>

      <div className="pages-grid">
        {allPages.map(n => {
          const d = pageEdits[n]
          const textEdits  = (d?.textItems||[]).filter(it=>it.current!==it.original).length
          const addedEdits = (d?.addedItems||[]).filter(it=>it.text.trim()).length
          const total = textEdits + addedEdits
          const removed = removedPages.has(n)
          return (
            <div key={n} className={`pcard ${removed?'pcard--removed':''}`}>
              <div className="pcard__header">
                <span className="pcard__num">Page {n}</span>
                <div className="pcard__btns">
                  {!removed && <button className="pcard__edit-btn" onClick={()=>setEditingPage(n)}>✏️ Edit</button>}
                  <button
                    className={`pcard__remove-btn ${removed?'pcard__remove-btn--restore':''}`}
                    onClick={()=>toggleRemove(n)}
                  >{removed ? '↩ Restore' : '✕ Remove'}</button>
                </div>
              </div>
              {total > 0 && <div className="pcard__badge">✏️ {total} edit{total>1?'s':''}</div>}
              <div className="pcard__thumb">
                <PDFPageCanvas pdfDoc={pdfDoc} pageNumber={n} scale={THUMB_SCALE} />
              </div>
            </div>
          )
        })}
      </div>

      {editingPage && pdfDoc && (
        <PageEditModal
          pdfDoc={pdfDoc}
          pageNumber={editingPage}
          savedData={pageEdits[editingPage]}
          onSave={data => setPageEdits(prev=>({...prev,[editingPage]:data}))}
          onClose={() => setEditingPage(null)}
        />
      )}
    </div>
  )
}
