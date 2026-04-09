import { useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export function loadPdfJs(arrayBuffer) {
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise
}

export default function PDFPageCanvas({ pdfDoc, pageNumber, scale = 1.2, onClick }) {
  const canvasRef = useRef(null)
  const renderTaskRef = useRef(null)

  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false

    pdfDoc.getPage(pageNumber).then(page => {
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
      }
      renderTaskRef.current = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      })
    })

    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
      }
    }
  }, [pdfDoc, pageNumber, scale])

  return (
    <canvas
      ref={canvasRef}
      onClick={onClick}
      style={{ cursor: onClick ? 'crosshair' : 'default', display: 'block' }}
    />
  )
}
