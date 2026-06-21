import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X } from 'lucide-react';

interface DocumentUploaderProps {
  onUploadSuccess?: () => void;
  disabled?: boolean;
}

export function DocumentUploader({ onUploadSuccess, disabled }: DocumentUploaderProps) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const { uploadDocument } = await import('../../../features/knowledge/api/rag');
      for (const file of files) {
        await uploadDocument(file);
      }
      onUploadSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, [onUploadSuccess]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'application/pdf': ['.pdf'],
      'text/markdown': ['.md', '.markdown'],
      'text/plain': ['.txt'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    maxFiles: 5,
    disabled: disabled || uploading,
    onDrop,
  });

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${disabled || uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />
        <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
        {uploading ? (
          <p className="text-gray-600">正在上传...</p>
        ) : isDragActive ? (
          <p className="text-blue-600">拖放文件到这里...</p>
        ) : (
          <div className="text-gray-600">
            <p className="mb-1">拖放 PDF、Markdown 或 TXT 文件到这里</p>
            <p className="text-sm text-gray-400">或点击选择文件（最大 50MB，最多 5 个）</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg">
          <X className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
