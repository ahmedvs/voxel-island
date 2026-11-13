import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { sanitizeVoxelArray, extractJsonArrayFromText, pruneFloatingVoxels } from './voxelCore.js';

export const DEFAULT_VOXEL_MODEL = 'gemini-4-hydrogen';
export const MIN_VOXEL_COUNT = 30;

const ARCHITECT_SYSTEM_PROMPT = `You are a master 3D Voxel Architect API. Convert the user's text prompt into a complete, recognizable, cohesive 3D voxel structure represented as a strict JSON array of objects.

STRICT STRUCTURAL RULES:
1. Output ONLY a compact valid JSON array (no markdown fences, no commentary, no extra indentation).
2. Each object must have exactly 4 keys: "x", "y", "z" (integers), and "c" (hex color string, e.g. "#6D4C41").
3. Coordinate bounds (centered around x=0, z=0):
   - "x" between -5 and 5
   - "z" between -5 and 5
   - "y" between 0 and 14 (where y=0 is the ground base)
4. Completeness & Volume:
   - Minimum 30 voxels and maximum 300 voxels per structure (target 65 to 155 voxels using clean exterior shells rather than wasteful hidden interior fills).
   - NEVER output just 1-10 isolated or scattered blocks.
   - Build clean, logical, continuous structural parts (for example: solid foundation, enclosed walls with doorway/windows, pitched roof; OR grounded trunk at y=0..4 directly touching a dense leaf canopy at y=4..9; OR stone base, tower column, balcony, and lantern cap).
   - ZERO floating disconnected blocks: every voxel at y > 0 MUST touch/connect to neighboring voxels down to the grounded y=0 base.
5. Semantic, Realistic Color Rules:
   - Use realistic, semantic colors for each structural part rather than mixing random pastel colors block-by-block.
   - Use a cohesive 3 to 6 color palette grouped cleanly by part:
     * Wood / tree trunks / beams: "#6D4C41", "#5D4037", "#8B5A2B"
     * Foliage / leaves / grass: "#4CAF50", "#388E3C", "#2E7D32" (or cherry blossoms "#F4B6C2", "#E899A8" only if cherry/sakura is requested)
     * Stone / foundations / paths: "#757575", "#616161", "#8D8479"
     * Brick / terracotta / roofs: "#B85D43", "#A8523A", "#8D4330"
     * Cream / sandstone / plaster walls: "#E6D7C3", "#D7C3A8", "#C8B092"
     * Water / glass / lanterns: "#4FC3F7", "#29B6F6", "#FFD54F"
   - Avoid harsh neon colors and avoid randomizing colors between adjacent voxels of the same surface.`;

export function resolveServerModelId(rawModel) {
  const clean = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (!clean) return DEFAULT_VOXEL_MODEL;

  const lower = clean.toLowerCase();
  if (
    lower === 'hydrogen' ||
    lower === 'gemini-hydrogen' ||
    lower === 'gemini-4-flash' ||
    lower === 'gemini-flash' ||
    lower === 'gemini flash'
  ) {
    return 'gemini-4-hydrogen';
  }
  if (lower === 'lite' || lower === 'flash-lite' || lower === 'gemini-lite') {
    return 'gemini-3.1-flash-lite';
  }
  return clean;
}

function supportsThinkingLevel(modelId) {
  const lower = modelId.toLowerCase();
  return lower.startsWith('gemini-3') || lower.startsWith('gemini-4');
}

function getGeminiClient() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const apiKey = localStorage.getItem('voxel_gemini_api_key') || env.VITE_GEMINI_API_KEY || '';
  if (!apiKey || !apiKey.trim()) {
    const err = new Error('يرجى إدخال مفتاح Gemini API في نافذة الإعدادات أو استخدام «بناء تجريبي»');
    err.status = 503;
    err.missingApiKey = true;
    throw err;
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

export async function fetchActiveModelConfig(modelId) {
  return {
    defaultModel: DEFAULT_VOXEL_MODEL,
    activeModel: resolveServerModelId(modelId),
  };
}

export async function generateVoxelStructureWithGemini({ prompt, modelId, onModelResolved }) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    throw new Error('يرجى كتابة وصف للمبنى المطلوب');
  }

  const resolvedModel = resolveServerModelId(modelId);
  if (typeof onModelResolved === 'function') {
    onModelResolved(resolvedModel);
  }

  const ai = getGeminiClient();

  const userInstruction = `Build a complete, connected, recognizable 3D voxel structure centered near x=0,z=0 with realistic semantic colors (65 to 155 voxels, zero floating disconnected blocks) for: ${cleanPrompt}`;

  const response = await ai.models.generateContent({
    model: resolvedModel,
    contents: userInstruction,
    config: {
      systemInstruction: ARCHITECT_SYSTEM_PROMPT,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            x: { type: Type.INTEGER },
            y: { type: Type.INTEGER },
            z: { type: Type.INTEGER },
            c: { type: Type.STRING },
          },
          required: ['x', 'y', 'z', 'c'],
        },
      },
      ...(supportsThinkingLevel(resolvedModel)
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } }
        : {}),
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('لم يُرجع نموذج Gemini بيانات تصميم صالحة');
  }

  const rawArray = extractJsonArrayFromText(text);
  const sanitized = sanitizeVoxelArray(rawArray);
  const pruned = pruneFloatingVoxels(sanitized);

  const voxels = pruned.length >= MIN_VOXEL_COUNT ? pruned : sanitized;
  if (voxels.length < MIN_VOXEL_COUNT) {
    throw new Error('لم يكتمل توليد مجسم مترابط بالقدر الكافي، حاول وصفاً أوضح أو «بناء تجريبي»');
  }

  return voxels;
}
