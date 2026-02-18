import { useState, useEffect, useCallback } from 'react';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? '';

interface UseMemoryReturn {
  content: string;
  files: string[];
  selectedFile: string | null;
  loading: boolean;
  error: string | null;
  selectFile: (filename: string | null) => void;
  refresh: () => Promise<void>;
}

export function useMemory(): UseMemoryReturn {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMain = useCallback(async () => {
    try {
      setLoading(true);
      const [memRes, filesRes] = await Promise.all([
        fetch(`${VITALS_API}/api/memory`),
        fetch(`${VITALS_API}/api/memory/files`),
      ]);
      if (memRes.ok) {
        const data = await memRes.json() as { content: string };
        setContent(data.content);
      }
      if (filesRes.ok) {
        const data = await filesRes.json() as { files: string[] };
        setFiles(data.files);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch memory');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectFile = useCallback(async (filename: string | null) => {
    setSelectedFile(filename);
    if (!filename) return;
    try {
      setLoading(true);
      const res = await fetch(`${VITALS_API}/api/memory/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { content: string };
      setContent(data.content);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch file');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMain();
  }, [fetchMain]);

  return { content, files, selectedFile, loading, error, selectFile, refresh: fetchMain };
}
