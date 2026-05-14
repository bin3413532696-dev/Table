import { useOutletContext } from 'react-router-dom';
import type { WritingProjectOutletContext } from './types';

export function useWritingProject() {
  return useOutletContext<WritingProjectOutletContext>();
}
