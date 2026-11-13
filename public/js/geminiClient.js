import { sanitizeVoxelArray } from './voxelCore.js';

/**
 * Fetches the active resolved Gemini model ID configured on the server.
 */
export async function fetchActiveModelConfig(modelId) {
  const query =
    typeof modelId === 'string' && modelId.trim()
      ? `?modelId=${encodeURIComponent(modelId.trim())}`
      : '';
  const response = await fetch(`/api/gemini/config${query}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Calls the backend Express endpoint (/api/gemini/voxel) to generate a 3D voxel blueprint via Gemini on the server.
 */
export async function generateVoxelStructureWithGemini({ prompt, modelId, onModelResolved }) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('يرجى كتابة وصف للمبنى المطلوب');
  }

  const response = await fetch('/api/gemini/voxel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: cleanPrompt,
      modelId: typeof modelId === 'string' && modelId.trim() ? modelId.trim() : undefined,
    }),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error || `تعذر الاتصال بالخادم لتوليد المبنى (${response.status})`
    );
  }

  if (!data || !Array.isArray(data.voxels)) {
    throw new Error('لم يُرجع الخادم بيانات تصميم فوكسل صالحة');
  }

  if (typeof onModelResolved === 'function' && typeof data.model === 'string' && data.model) {
    onModelResolved(data.model);
  }

  return sanitizeVoxelArray(data.voxels);
}
