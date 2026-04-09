import { useState, useCallback } from 'react'
import { PDFDocument } from 'pdf-lib'
import { useDropzone } from 'react-dropzone'
import PDFPageCanvas, { loadPdfJs } from './PDFPageCanvas'

// Color palette – each uploaded file gets a unique accent colour
const FILE_COLORS = [
  { bg:'#eff6ff', border:'#3b82f6', dot:'#3b82f6', light:'rgba(59,130,246,.12)' },
  { bg:'#faf5ff', border:'#8b5cf6', dot:'#8b5cf6', light:'rgba(139,92,246,.12)' },
  { bg:'#f0fdf4', border:'#22c55e', dot:'#22c55e', light:'rgba(34,197,94,.12)'  },
  { bg:'#fff7ed', border:'#f97316', dot:'#f97316', light:'rgba(249,115,22,.12)' },
  { bg:'#fdf4ff', border:'#d946ef', dot:'#d946ef', light:'rgba(217,70,239,.12)' },
  { bg:'#f0fdfa', border:'#14b8a6', dot:'#14b8a6', light:'rgba(20,184,166,.12)' },
]
const fc = (idx) => FILE_COLORS[idx % FILE_COLORS.length]

export default function PDFMerger() {
  const [files,         setFiles]         = useState([])
  const [mergeSequence, setMergeSequence] = useState([])
  const [merging,       setMerging]       = useState(false)

  const onDrop = useCallback(async (accepted) => {
    const loaded = await Promise.all(accepted.map(async file => {
      const ab      = await file.arrayBuffer()
      const pdfDoc  = await loadPdfJs(ab.slice(0))
      const pageCount = pdfDoc.numPages
      return { id: crypto.randomUUID(), name: file.name, arrayBuffer: ab, pdfDoc, pageCount }
    }))

    setFiles(prev => {
      const next = [...prev, ...loaded]
      setMergeSequence(seq => {
        const appended = loaded.flatMap(f =>
          Array.from({ length: f.pageCount }, (_, i) => ({ fileId: f.id, pageNum: i + 1 }))
        )
        return [...seq, ...appended]
      })
      return next
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'application/pdf': ['.pdf'] }, multiple: true,
  })

  const isInSeq    = (fid, p)  => mergeSequence.some(s => s.fileId===fid && s.pageNum===p)
  const togglePage = (fid, p)  => setMergeSequence(prev =>
    prev.some(s=>s.fileId===fid&&s.pageNum===p)
      ? prev.filter(s=>!(s.fileId===fid&&s.pageNum===p))
      : [...prev,{fileId:fid,pageNum:p}]
  )
  const selectAll  = (fid, n)  => setMergeSequence(prev => {
    const have = new Set(prev.filter(s=>s.fileId===fid).map(s=>s.pageNum))
    return [...prev, ...Array.from({length:n},(_,i)=>i+1).filter(p=>!have.has(p)).map(pageNum=>({fileId:fid,pageNum}))]
  })
  const selectNone = (fid)     => setMergeSequence(prev => prev.filter(s=>s.fileId!==fid))
  const removeFile = (id)      => { setFiles(p=>p.filter(f=>f.id!==id)); setMergeSequence(p=>p.filter(s=>s.fileId!==id)) }
  const seqMoveUp  = (i)       => setMergeSequence(prev => { if(!i) return prev; const a=[...prev];[a[i-1],a[i]]=[a[i],a[i-1]];return a })
  const seqMoveDown= (i)       => setMergeSequence(prev => { if(i===prev.length-1) return prev; const a=[...prev];[a[i],a[i+1]]=[a[i+1],a[i]];return a })
  const seqRemove  = (i)       => setMergeSequence(prev=>prev.filter((_,j)=>j!==i))
  const clearSeq   = ()        => setMergeSequence([])

  const handleMerge = async () => {
    if (!mergeSequence.length) return
    setMerging(true)
    try {
      const srcs = {}
      for (const f of files) srcs[f.id] = await PDFDocument.load(f.arrayBuffer)
      const merged = await PDFDocument.create()
      for (const {fileId,pageNum} of mergeSequence) {
        const [p] = await merged.copyPages(srcs[fileId],[pageNum-1])
        merged.addPage(p)
      }
      const url = URL.createObjectURL(new Blob([await merged.save()],{type:'application/pdf'}))
      Object.assign(document.createElement('a'),{href:url,download:'merged.pdf'}).click()
      URL.revokeObjectURL(url)
    } finally { setMerging(false) }
  }

  const getFile   = id  => files.find(f=>f.id===id)
  const fileIdx   = id  => files.findIndex(f=>f.id===id)
  const shortName = n   => n.replace(/\.pdf$/i,'').slice(0,22)

  // ── Landing (no files yet) ───────────────────────────────────────────────
  if (!files.length) {
    return (
      <div className="merger-landing">
        <div className="merger-hero">
          <div className="merger-hero__badge">Unlimited files · Any order · Free</div>
          <h2 className="merger-hero__title">
            Merge PDFs<br/><span>Your Way, Any Order</span>
          </h2>
          <p className="merger-hero__sub">
            Pick exactly which pages from each PDF, arrange them in any sequence, and download a perfectly merged file — all in your browser.
          </p>

          <div {...getRootProps()} className={`merger-drop ${isDragActive?'merger-drop--over':''}`}>
            <input {...getInputProps()} />
            <div className="merger-drop__icon">📂</div>
            <p className="merger-drop__title">{isDragActive?'Release to load!':'Drop your PDFs here'}</p>
            <p className="merger-drop__sub">or click to browse · multiple files supported</p>
          </div>
        </div>

        <div className="merger-feats">
          {[
            { icon:'🎯', col:'#3b82f6', title:'Pick Any Pages',      desc:'Select individual pages from each PDF — not forced to include everything.' },
            { icon:'🔀', col:'#8b5cf6', title:'Custom Page Order',    desc:'Arrange pages from different PDFs in any sequence using the merge queue.' },
            { icon:'🎨', col:'#22c55e', title:'Color-coded Files',    desc:'Each PDF gets a unique colour so you always know which page came from where.' },
            { icon:'⚡', col:'#f97316', title:'Instant Download',     desc:'Processing is done entirely in your browser. Nothing is uploaded anywhere.' },
          ].map((f,i) => (
            <div key={f.title} className="merger-feat" style={{'--fc':f.col,'animationDelay':`${i*0.08}s`}}>
              <div className="merger-feat__icon" style={{background:`${f.col}18`,color:f.col}}>{f.icon}</div>
              <h3 className="merger-feat__title">{f.title}</h3>
              <p className="merger-feat__desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Files loaded ─────────────────────────────────────────────────────────
  return (
    <div className="merger-root">

      {/* Top drop strip (add more files) */}
      <div {...getRootProps()} className={`merger-strip ${isDragActive?'merger-strip--over':''}`}>
        <input {...getInputProps()} />
        <span className="merger-strip__icon">＋</span>
        <span>{isDragActive ? 'Drop to add more PDFs…' : 'Drop more PDFs here to add them'}</span>
      </div>

      <div className="merger-layout">

        {/* ══ LEFT: Source PDFs ══════════════════════════════════════════════ */}
        <section className="source-section">
          <div className="msec-header">
            <div className="msec-header__left">
              <span className="msec-icon">📁</span>
              <div>
                <h2 className="msec-title">Source PDFs</h2>
                <p className="msec-sub">{files.length} file{files.length!==1?'s':''} · Click pages to toggle in/out of sequence</p>
              </div>
            </div>
          </div>

          {files.map((file, fi) => {
            const color   = fc(fi)
            const selCnt  = mergeSequence.filter(s=>s.fileId===file.id).length
            const pct     = Math.round(selCnt/file.pageCount*100)
            return (
              <div key={file.id} className="source-card" style={{'--card-border':color.border,'--card-light':color.light}}>
                <div className="source-card__head">
                  <span className="source-card__dot" style={{background:color.dot}}>#{fi+1}</span>
                  <div className="source-card__meta">
                    <span className="source-card__name" title={file.name}>{file.name}</span>
                    <div className="source-card__progress">
                      <div className="progress-bar">
                        <div className="progress-bar__fill" style={{width:`${pct}%`,background:color.border}}/>
                      </div>
                      <span className="progress-label" style={{color:color.border}}>{selCnt}/{file.pageCount} pages</span>
                    </div>
                  </div>
                  <div className="source-card__actions">
                    <button className="chip-btn" style={{'--cc':color.border}} onClick={()=>selectAll(file.id,file.pageCount)}>All</button>
                    <button className="chip-btn" style={{'--cc':color.border}} onClick={()=>selectNone(file.id)}>None</button>
                    <button className="chip-btn chip-btn--del" onClick={()=>removeFile(file.id)}>✕</button>
                  </div>
                </div>

                <div className="source-pages">
                  {Array.from({length:file.pageCount},(_,i)=>i+1).map(p => {
                    const on = isInSeq(file.id,p)
                    const seqPos = mergeSequence.findIndex(s=>s.fileId===file.id&&s.pageNum===p)
                    return (
                      <button
                        key={p}
                        className={`src-page ${on?'src-page--on':'src-page--off'}`}
                        style={on?{'--sp-border':color.border,'--sp-bg':color.light}:{}}
                        onClick={()=>togglePage(file.id,p)}
                        title={on?`Remove page ${p}`:`Add page ${p} to sequence`}
                      >
                        <div className="src-page__canvas">
                          <PDFPageCanvas pdfDoc={file.pdfDoc} pageNumber={p} scale={0.2}/>
                        </div>
                        <span className="src-page__lbl">p{p}</span>
                        {on && <div className="src-page__badge" style={{background:color.border}}>{seqPos+1}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </section>

        {/* ══ RIGHT: Merge Sequence ══════════════════════════════════════════ */}
        <section className="seq-section">
          <div className="msec-header msec-header--seq">
            <div className="msec-header__left">
              <span className="msec-icon">🗂</span>
              <div>
                <h2 className="msec-title">Merge Sequence</h2>
                <p className="msec-sub">{mergeSequence.length} page{mergeSequence.length!==1?'s':''} queued</p>
              </div>
            </div>
          </div>

          {/* action bar */}
          <div className="seq-bar">
            <button
              className={`btn-merge-big ${merging?'btn-merge-big--busy':''}`}
              onClick={handleMerge}
              disabled={!mergeSequence.length||merging}
            >
              {merging
                ? <><span className="spin-icon">⟳</span> Merging…</>
                : <><span>⬇</span> Merge &amp; Download <span className="merge-count">{mergeSequence.length} pages</span></>
              }
            </button>
            {mergeSequence.length>0 && <button className="btn btn-ghost btn-sm" onClick={clearSeq}>Clear All</button>}
          </div>

          {mergeSequence.length===0 ? (
            <div className="seq-empty">
              <div className="seq-empty__icon">🗂</div>
              <p>Your merge queue is empty</p>
              <span>Click page thumbnails on the left to add them here</span>
            </div>
          ) : (
            <div className="seq-list">
              {mergeSequence.map(({fileId,pageNum},idx) => {
                const file  = getFile(fileId); if(!file) return null
                const fi    = fileIdx(fileId)
                const color = fc(fi)
                return (
                  <div key={`${fileId}-${pageNum}-${idx}`} className="seq-item" style={{'--si-color':color.border,'--si-light':color.light}}>
                    <div className="seq-item__pos">{idx+1}</div>

                    <div className="seq-item__thumb">
                      <PDFPageCanvas pdfDoc={file.pdfDoc} pageNumber={pageNum} scale={0.15}/>
                    </div>

                    <div className="seq-item__info">
                      <span className="seq-item__dot" style={{background:color.dot}}/>
                      <div className="seq-item__text">
                        <span className="seq-item__file" title={file.name}>{shortName(file.name)}</span>
                        <span className="seq-item__page">Page {pageNum}</span>
                      </div>
                    </div>

                    <div className="seq-item__btns">
                      <button className="seq-btn seq-btn--up"   onClick={()=>seqMoveUp(idx)}   disabled={idx===0}                        title="Move up">▲</button>
                      <button className="seq-btn seq-btn--down" onClick={()=>seqMoveDown(idx)} disabled={idx===mergeSequence.length-1}   title="Move down">▼</button>
                      <button className="seq-btn seq-btn--del"  onClick={()=>seqRemove(idx)}                                             title="Remove">×</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
