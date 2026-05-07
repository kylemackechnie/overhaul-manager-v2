import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

interface Props {
  /** Whether the scanner overlay is open */
  open: boolean
  /** Called when a barcode is decoded successfully */
  onScan: (text: string) => void
  /** Called when user dismisses without scanning */
  onClose: () => void
  /** Optional title shown at top of overlay (e.g. "Scan Material #") */
  title?: string
  /** Hint shown below the target rectangle */
  hint?: string
}

type ScannerState =
  | { kind: 'init' }
  | { kind: 'requesting' }
  | { kind: 'scanning' }
  | { kind: 'error', message: string }

/**
 * Full-screen camera overlay that decodes barcodes (Code 128, Code 39, QR,
 * Data Matrix, EAN, UPC) via @zxing/browser. Returns the decoded string to
 * the parent and self-dismisses.
 *
 * **Library choice**: @zxing/browser was chosen over BarcodeDetector API
 * because BarcodeDetector is unsupported on iOS Safari (including PWA
 * standalone). zxing-js works everywhere getUserMedia works.
 *
 * **iOS PWA gotchas handled**:
 * - playsinline + muted on the video element (iOS won't autoplay otherwise)
 * - awaits video.play() inside the user-gesture (the open prop change is
 *   triggered from a button tap, which is enough — the open effect runs
 *   synchronously on tap)
 * - Falls back to back camera (environment) but accepts front if denied
 * - Catches NotAllowedError, NotFoundError, NotReadableError separately
 *
 * **Camera lifecycle**:
 * - Stream is acquired on open, fully released on close
 * - Decoder runs in a continuous loop; each successful decode triggers
 *   onScan() and immediately stops decoding to prevent double-scans
 */
export function MobileBarcodeScanner({ open, onScan, onClose, title, hint }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stoppedRef = useRef(false)
  const [state, setState] = useState<ScannerState>({ kind: 'init' })

  useEffect(() => {
    if (!open) return
    stoppedRef.current = false
    setState({ kind: 'requesting' })

    let cancelled = false

    async function start() {
      try {
        // Configure reader with the formats we actually expect from industrial
        // parts labels. Limiting formats speeds up decoding noticeably.
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.DATA_MATRIX,
          BarcodeFormat.QR_CODE,
          BarcodeFormat.EAN_13,
          BarcodeFormat.UPC_A,
        ])
        const reader = new BrowserMultiFormatReader(hints)
        readerRef.current = reader

        // Prefer back-facing camera. On phones with multiple cameras,
        // 'environment' picks the standard rear lens. Some devices need
        // 'continuous' focus mode to lock onto small barcodes.
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        }

        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch (err) {
          // If the back camera is unavailable, fall back to ANY camera
          if ((err as Error).name === 'OverconstrainedError' || (err as Error).name === 'ConstraintNotSatisfiedError') {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          } else {
            throw err
          }
        }

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        video.srcObject = stream
        // iOS quirks: playsinline lets video play without going fullscreen,
        // muted allows autoplay
        video.setAttribute('playsinline', 'true')
        video.muted = true
        await video.play()

        if (cancelled) return
        setState({ kind: 'scanning' })

        // decodeFromVideoElement runs continuously; each successful read
        // invokes the callback with the result.
        reader.decodeFromVideoElement(video, (result, err) => {
          if (stoppedRef.current) return
          if (result) {
            const text = result.getText()
            stoppedRef.current = true
            // Haptic feedback if available — confirms scan succeeded
            try { navigator.vibrate?.(30) } catch { /* ignore */ }
            onScan(text)
          }
          // err is a NotFoundException on every frame without a barcode —
          // expected, ignore
          void err
        })
      } catch (err) {
        if (cancelled) return
        const e = err as Error
        let msg = 'Camera failed to start.'
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          msg = 'Camera permission denied. Tap the camera icon in your browser address bar to allow access, or check your phone\'s app settings.'
        } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
          msg = 'No camera found on this device.'
        } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
          msg = 'Camera is in use by another app. Close other camera apps and try again.'
        } else if (e.name === 'NotSupportedError' || e.message?.includes('not supported')) {
          msg = 'Camera scanning is not supported in this browser. Type the value instead.'
        } else if (e.message) {
          msg = e.message
        }
        setState({ kind: 'error', message: msg })
      }
    }

    start()

    return () => {
      cancelled = true
      stoppedRef.current = true
      // Stop the zxing decode loop. (No public stop() in @zxing/browser 0.2 —
      // releasing the stream causes decodeFromVideoElement to error out
      // gracefully on its next frame.)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      readerRef.current = null
    }
  }, [open, onScan])

  if (!open) return null

  return (
    <div className="mobile-scanner-overlay" role="dialog" aria-modal="true">
      <video
        ref={videoRef}
        className="mobile-scanner-video"
        playsInline
        muted
      />

      {/* Top bar */}
      <div className="mobile-scanner-topbar">
        <button className="mobile-scanner-close" onClick={onClose} aria-label="Close scanner">✕</button>
        {title && <div className="mobile-scanner-title">{title}</div>}
        <div style={{ width: '40px' }} /> {/* spacer for centred title */}
      </div>

      {/* Target rectangle / state overlay */}
      {state.kind === 'requesting' && (
        <div className="mobile-scanner-state">
          <span className="spinner" style={{ width: 32, height: 32, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
          <div>Starting camera…</div>
        </div>
      )}
      {state.kind === 'scanning' && (
        <>
          <div className="mobile-scanner-target">
            <div className="mobile-scanner-corner mobile-scanner-corner-tl" />
            <div className="mobile-scanner-corner mobile-scanner-corner-tr" />
            <div className="mobile-scanner-corner mobile-scanner-corner-bl" />
            <div className="mobile-scanner-corner mobile-scanner-corner-br" />
          </div>
          {hint && <div className="mobile-scanner-hint">{hint}</div>}
        </>
      )}
      {state.kind === 'error' && (
        <div className="mobile-scanner-state mobile-scanner-state-error">
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Cannot scan</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.85 }}>{state.message}</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onClose}>Type instead</button>
        </div>
      )}
    </div>
  )
}
