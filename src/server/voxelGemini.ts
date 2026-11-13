import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  extractJsonArrayFromText,
  pruneFloatingVoxels,
  sanitizeVoxelArray,
} from '../../public/js/voxelCore.js';

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

export function resolveServerModelId(rawModel?: unknown): string {
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

function supportsThinkingLevel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('gemini-3') || lower.startsWith('gemini-4');
}

function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error('مفتاح Gemini API غير مهيأ على الخادم حالياً') as Error & {
      status?: number;
    };
    err.status = 503;
    throw err;
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface VoxelBlock {
  x: number;
  y: number;
  z: number;
  c: string;
}

function isTransientUpstreamError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; statusCode?: number; message?: string };
  if (e.status === 503 || e.statusCode === 503) return true;
  const msg = String(e.message || '');
  return msg.includes('"code":503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
}

async function generateContentWithTransientRetry(
  ai: GoogleGenAI,
  resolvedModel: string,
  userInstruction: string
) {
  const callApi = () =>
    ai.models.generateContent({
      model: resolvedModel,
      contents: userInstruction,
      config: {
        systemInstruction: ARCHITECT_SYSTEM_PROMPT,
        maxOutputTokens: 16384,
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

  try {
    return await callApi();
  } catch (err) {
    if (!isTransientUpstreamError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return callApi();
  }
}

async function requestVoxelBlueprint(
  ai: GoogleGenAI,
  resolvedModel: string,
  userInstruction: string
): Promise<{ voxels: VoxelBlock[]; rawCount: number; prunedCount: number }> {
  const response = await generateContentWithTransientRetry(ai, resolvedModel, userInstruction);

  const candidateText = response.text;
  if (!candidateText) {
    const err = new Error('لم يُرجع النموذج بيانات تصميم فوكسل صالحة') as Error & {
      status?: number;
    };
    err.status = 502;
    throw err;
  }

  const rawArray = extractJsonArrayFromText(candidateText);
  const sanitized = sanitizeVoxelArray(rawArray) as VoxelBlock[];
  const pruned = pruneFloatingVoxels(sanitized) as VoxelBlock[];

  // Prefer fully grounded-connected voxels when >= 30; keep sanitized if pruning dropped a large structure due to a 1-voxel gap
  const voxels = pruned.length >= MIN_VOXEL_COUNT ? pruned : sanitized;
  return {
    voxels,
    rawCount: rawArray.length,
    prunedCount: pruned.length,
  };
}

export async function generateVoxelStructureOnServer({
  prompt,
  modelId,
}: {
  prompt: string;
  modelId?: string;
}): Promise<{ voxels: VoxelBlock[]; model: string }> {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) {
    const err = new Error('يرجى كتابة وصف للمبنى المطلوب') as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  if (cleanPrompt.length > 200) {
    const err = new Error('وصف المبنى طويل جداً (الحد الأقصى 200 حرف)') as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  const resolvedModel = resolveServerModelId(modelId);
  const ai = createGeminiClient();

  let attempt = await requestVoxelBlueprint(
    ai,
    resolvedModel,
    `Build a complete, connected, recognizable 3D voxel structure centered near x=0,z=0 with realistic semantic colors (65 to 155 voxels, zero floating disconnected blocks) for: ${cleanPrompt}`
  );

  console.info(
    `[voxelGemini] model=${resolvedModel} attempt=1 raw=${attempt.rawCount} kept=${attempt.voxels.length} connected=${attempt.prunedCount}`
  );

  // Automatic retry if output came back sparse (< 30 voxels)
  if (attempt.voxels.length < MIN_VOXEL_COUNT) {
    const retry = await requestVoxelBlueprint(
      ai,
      resolvedModel,
      `Your previous output had only ${attempt.voxels.length} voxels. Generate a complete, connected 3D voxel structure with 60 to 155 voxels centered near x=0,z=0, grounded at y=0, and consistent semantic colors for: ${cleanPrompt}`
    );
    console.info(
      `[voxelGemini] model=${resolvedModel} attempt=2 raw=${retry.rawCount} kept=${retry.voxels.length} connected=${retry.prunedCount}`
    );
    if (retry.voxels.length > attempt.voxels.length) {
      attempt = retry;
    }
  }

  if (attempt.voxels.length < MIN_VOXEL_COUNT) {
    const err = new Error('لم يكتمل توليد مجسم مترابط بالقدر الكافي، حاول وصفاً أوضح') as Error & {
      status?: number;
    };
    err.status = 502;
    throw err;
  }

  return {
    voxels: attempt.voxels,
    model: resolvedModel,
  };
}
