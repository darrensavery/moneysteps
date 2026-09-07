// app/src/components/dashboard/ReceiptPicker.tsx
import { useRef, useState } from 'react';
import { compressImage } from '../../lib/imageCompression';

type Props = {
  onFile: (file: File) => void;
  onClear: () => void;
  onError: (msg: string) => void;
  existingReceiptKey?: string | null;
};

export function ReceiptPicker({ onFile, onClear, onError, existingReceiptKey }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  // Kept on failure so "Try again" can retry the same file — the user
  // already picked the right one, a failed compression shouldn't send them
  // back to the camera roll to find it a second time.
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setCompressing(true);
    setErrorMsg(null);
    try {
      const compressed = await compressImage(file);
      const url = URL.createObjectURL(compressed);
      setPreview(url);
      setFailedFile(null);
      onFile(compressed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not process image';
      setFailedFile(file);
      setErrorMsg(msg);
      onError(msg);
    } finally {
      setCompressing(false);
    }
  }

  function handleClear() {
    setPreview(null);
    setFailedFile(null);
    setErrorMsg(null);
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
    onClear();
  }

  const isPdfFile = preview === 'pdf';

  return (
    <div className="flex flex-col gap-3">
      {!preview && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface-alt)] rounded-xl py-3 text-sm font-medium text-[var(--color-text)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            Take photo
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface-alt)] rounded-xl py-3 text-sm font-medium text-[var(--color-text)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {existingReceiptKey ? 'Replace' : 'Upload'}
          </button>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
      <input ref={galleryRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.type === 'application/pdf') { setPreview('pdf'); onFile(f); }
          else handleFile(f);
          e.target.value = '';
        }} />

      {compressing && (
        <p className="text-xs text-[var(--color-text-muted)] text-center">Optimising image…</p>
      )}

      {failedFile && !compressing && (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30">
          <p className="text-xs text-red-600 dark:text-red-400 flex-1 min-w-0">{errorMsg}</p>
          <button
            type="button"
            onClick={() => handleFile(failedFile)}
            className="shrink-0 text-xs font-bold text-red-600 dark:text-red-400 hover:opacity-80 cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {preview && !compressing && (
        <div className="relative rounded-xl overflow-hidden border border-[var(--color-border)]">
          {isPdfFile ? (
            <div className="flex items-center gap-2 p-4 bg-[var(--color-surface-alt)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span className="text-sm font-medium text-[var(--color-text)]">PDF receipt ready</span>
            </div>
          ) : (
            <img src={preview} alt="Receipt preview" className="w-full max-h-48 object-cover" />
          )}
          <button
            type="button"
            onClick={handleClear}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
            aria-label="Remove receipt"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
