import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, Image as ImageIcon, File as FileIcon, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { uploadFile } from '../lib/storage';
import { normalizeImageForUpload } from '../lib/imageNormalize';

interface FileUploadProps {
  bucket: string;
  path: string;
  accept?: string;
  maxSizeMb?: number;
  onUpload: (url: string) => void;
  children?: React.ReactNode;
  /** Convert/downscale images to a web-safe format (HEIC photos, oversized
      files) before validation and upload. Longest edge in px. */
  normalizeImageMaxDim?: number;
}

export default function FileUpload({
  bucket,
  path,
  accept,
  maxSizeMb = 10,
  onUpload,
  children,
  normalizeImageMaxDim,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const isImage = (file: File) => file.type.startsWith('image/');

  const validateFile = (file: File): string | null => {
    if (maxSizeMb && file.size > maxSizeMb * 1024 * 1024) {
      return `File exceeds ${maxSizeMb}MB limit`;
    }
    if (accept) {
      const allowed = accept.split(',').map((t) => t.trim().toLowerCase());
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      const typeMatch = allowed.some(
        (a) =>
          file.type === a ||
          ext === a ||
          (a.endsWith('/*') && file.type.startsWith(a.replace('/*', '/')))
      );
      if (!typeMatch) {
        return `File type not allowed. Accepted: ${accept}`;
      }
    }
    return null;
  };

  const handleFile = useCallback(
    async (rawFile: File) => {
      setError(null);

      let file = rawFile;
      if (normalizeImageMaxDim && rawFile.type.startsWith('image/')) {
        try {
          file = await normalizeImageForUpload(rawFile, { maxDim: normalizeImageMaxDim, maxSizeMb });
        } catch (err: any) {
          setError(err?.message || 'Image conversion failed');
          return;
        }
      }

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      // Show preview for images
      if (isImage(file)) {
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(file);
      }
      setFileName(file.name);

      // Build unique path
      const ext = file.name.split('.').pop();
      const timestamp = Date.now();
      const fullPath = `${path}/${timestamp}.${ext}`;

      setUploading(true);
      setProgress(0);

      // Simulate progress since Supabase JS doesn't expose upload progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      try {
        const result = await uploadFile(bucket, fullPath, file);
        clearInterval(progressInterval);
        setProgress(100);
        onUpload(result.url);
      } catch (err: any) {
        clearInterval(progressInterval);
        setError(err?.message || 'Upload failed');
        setPreview(null);
        setFileName(null);
      } finally {
        setUploading(false);
      }
    },
    [bucket, path, accept, maxSizeMb, onUpload, normalizeImageMaxDim]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const reset = () => {
    setPreview(null);
    setFileName(null);
    setProgress(0);
    setError(null);
  };

  return (
    <div className="space-y-2">
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'relative border border-dashed rounded-xl p-5 cursor-pointer transition-all text-center',
          'hover:border-brand hover:bg-brand/5',
          dragOver
            ? 'border-brand bg-brand/5'
            : 'border-outline',
          uploading && 'pointer-events-none opacity-70'
        )}
      >
        {children ? (
          children
        ) : preview ? (
          <div className="flex flex-col items-center gap-2">
            <img
              src={preview}
              alt="Preview"
              className="max-h-32 rounded-lg object-contain"
            />
            <span className="text-[11px] text-text-tertiary truncate max-w-[200px]">
              {fileName}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="w-9 h-9 rounded-xl bg-surface-secondary flex items-center justify-center">
              <Upload size={16} className="text-text-tertiary" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-text-secondary">
                Click or drag file to upload
              </p>
              <p className="text-[11px] text-text-tertiary mt-0.5">
                {accept ? `Accepted: ${accept}` : 'Any file type'} &middot; Max {maxSizeMb}MB
              </p>
            </div>
          </div>
        )}

        {uploading && (
          <div className="absolute inset-x-4 bottom-3 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-tertiary">
              <span className="flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" />
                Uploading...
              </span>
              <span>{progress}%</span>
            </div>
            <div className="h-1 rounded-full bg-surface-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {/* File info bar */}
      {fileName && !uploading && (
        <div className="flex items-center justify-between rounded-lg border border-outline bg-surface-secondary/50 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {preview ? (
              <ImageIcon size={14} className="text-text-tertiary shrink-0" />
            ) : (
              <FileIcon size={14} className="text-text-tertiary shrink-0" />
            )}
            <span className="text-[12px] text-text-secondary truncate">{fileName}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
            className="p-1 rounded-md hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-danger">{error}</p>
      )}
    </div>
  );
}
