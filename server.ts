import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_VOXEL_MODEL,
  generateVoxelStructureOnServer,
  resolveServerModelId,
} from './src/server/voxelGemini.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

interface PeerRecord {
  id: string;
  builderName: string;
  characterConfig: {
    presetId: string;
    skinColor?: string;
    outfitColor?: string;
    hairHatColor?: string;
  };
  x: number;
  y: number;
  z: number;
  yaw: number;
  isSitting: boolean;
  seatId: string | null;
  visible: boolean;
  speaking: boolean;
  micActive: boolean;
}

function sanitizePeerState(id: string, raw: unknown): PeerRecord {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cfg = (s.characterConfig && typeof s.characterConfig === 'object'
    ? s.characterConfig
    : {}) as Record<string, unknown>;

  const clampNum = (v: unknown, min: number, max: number, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
  };

  const name =
    typeof s.builderName === 'string' && s.builderName.trim()
      ? s.builderName.trim().slice(0, 32)
      : 'مستكشف';

  return {
    id,
    builderName: name,
    characterConfig: {
      presetId: typeof cfg.presetId === 'string' ? cfg.presetId.slice(0, 24) : 'explorer',
      skinColor: typeof cfg.skinColor === 'string' ? cfg.skinColor.slice(0, 9) : undefined,
      outfitColor: typeof cfg.outfitColor === 'string' ? cfg.outfitColor.slice(0, 9) : undefined,
      hairHatColor: typeof cfg.hairHatColor === 'string' ? cfg.hairHatColor.slice(0, 9) : undefined,
    },
    x: clampNum(s.x, -129, 129, 0),
    y: clampNum(s.y, 0, 25, 0),
    z: clampNum(s.z, -129, 129, 11.5),
    yaw: clampNum(s.yaw, -Math.PI * 2, Math.PI * 2, 0),
    isSitting: Boolean(s.isSitting),
    seatId: typeof s.seatId === 'string' ? s.seatId.slice(0, 32) : null,
    visible: s.visible !== false,
    speaking: Boolean(s.speaking),
    micActive: Boolean(s.micActive),
  };
}

function extractHttpStatus(err: unknown): number {
  if (!err || typeof err !== 'object') return 500;
  const e = err as { status?: number; statusCode?: number };
  const st = e.status;
  if (typeof st === 'number' && st >= 400 && st < 600) {
    return st;
  }
  const sc = e.statusCode;
  if (typeof sc === 'number' && sc >= 400 && sc < 600) {
    return sc;
  }
  return 500;
}

function formatErrorMessage(err: unknown, status: number): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (status === 400 || status === 401 || status === 403) {
    return raw || 'تعذر التحقق من إعدادات النموذج أو مفتاح Gemini على الخادم';
  }
  if (status === 404) {
    return 'النموذج المطلوب غير متوفر. جرّب gemini-4-hydrogen في الإعدادات.';
  }
  if (status === 429) {
    return 'تم تجاوز حد الطلبات المؤقت. يرجى المحاولة بعد قليل أو تجربة «بناء تجريبي».';
  }
  if (status === 503) {
    return raw.includes('غير مهيأ')
      ? raw
      : 'الخادم الذكي يشهد ضغطاً مؤقتاً حالياً، حاول مرة أخرى بعد لحظات أو جرّب «بناء تجريبي».';
  }
  return raw || 'تعذر الاتصال بنموذج Gemini على الخادم، حاول مرة أخرى';
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health and Root checks for Cloud Run
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ ok: true, defaultModel: DEFAULT_VOXEL_MODEL });
  });

  app.get('/health', (_req, res) => {
    res.status(200).send('OK');
  });

  app.get('/api/gemini/config', (req, res) => {
    try {
      const requested = typeof req.query.modelId === 'string' ? req.query.modelId : undefined;
      res.json({
        defaultModel: DEFAULT_VOXEL_MODEL,
        activeModel: resolveServerModelId(requested),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve config' });
    }
  });

  app.post('/api/gemini/voxel', async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
      const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : undefined;
      const result = await generateVoxelStructureOnServer({ prompt, modelId });
      res.json(result);
    } catch (err) {
      const status = extractHttpStatus(err);
      const message = formatErrorMessage(err, status);
      res.status(status).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);
  let wss: WebSocketServer | null = null;

  try {
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    const clients = new Map<string, { ws: WebSocket; state: PeerRecord }>();

    const broadcastExcept = (senderId: string, payload: unknown) => {
      try {
        const data = JSON.stringify(payload);
        for (const [id, entry] of clients.entries()) {
          if (id !== senderId && entry.ws.readyState === WebSocket.OPEN) {
            entry.ws.send(data);
          }
        }
      } catch (err) {
        console.error('Broadcast error:', err);
      }
    };

    wss.on('connection', (ws) => {
      const peerId = `peer_${crypto.randomBytes(5).toString('hex')}`;
      const defaultRecord = sanitizePeerState(peerId, {});
      clients.set(peerId, { ws, state: defaultRecord });

      const snapshot = Array.from(clients.values())
        .filter((entry) => entry.state.id !== peerId)
        .map((entry) => entry.state);

      try {
        ws.send(
          JSON.stringify({
            type: 'session:welcome',
            selfId: peerId,
            peers: snapshot,
          })
        );
      } catch (err) {
        console.error('Welcome send error:', err);
      }

      ws.on('message', (rawBuf) => {
        try {
          const msg = JSON.parse(rawBuf.toString());
          if (!msg || typeof msg.type !== 'string') return;

          const currentEntry = clients.get(peerId);
          if (!currentEntry) return;

          if (msg.type === 'player:join' || msg.type === 'player:state') {
            const nextState = sanitizePeerState(peerId, msg.state);
            currentEntry.state = nextState;
            broadcastExcept(peerId, {
              type: msg.type === 'player:join' ? 'player:joined' : 'player:updated',
              peer: nextState,
            });
            return;
          }

          if (msg.type === 'player:speaking') {
            currentEntry.state.speaking = Boolean(msg.speaking);
            currentEntry.state.micActive = Boolean(msg.micActive);
            broadcastExcept(peerId, {
              type: 'player:speaking',
              id: peerId,
              speaking: currentEntry.state.speaking,
              micActive: currentEntry.state.micActive,
            });
            return;
          }

          if (msg.type === 'rtc:offer' || msg.type === 'rtc:answer' || msg.type === 'rtc:ice') {
            const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
            const target = clients.get(targetId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: msg.type,
                  fromId: peerId,
                  sdp: msg.sdp,
                  candidate: msg.candidate,
                })
              );
            }
          }
        } catch (err) {
          console.error('WebSocket message handling error:', err);
        }
      });

      ws.on('close', () => {
        try {
          clients.delete(peerId);
          broadcastExcept(peerId, { type: 'player:left', id: peerId });
        } catch (err) {
          console.error('WebSocket close error:', err);
        }
      });
    });
  } catch (err) {
    console.error('WebSocket server initialization warning:', err);
  }

  // 1. Bind to PORT and '0.0.0.0' immediately before heavy asset/Vite operations
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Listening on 0.0.0.0:${PORT}`);
      resolve();
    });
    httpServer.on('error', (err) => {
      console.error('HTTP server listen error:', err);
      reject(err);
    });
  });

  // 2. Static files (production) or Vite middleware (development)
  if (isProduction) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('Vite middleware initialization warning (non-production):', err);
    }
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
