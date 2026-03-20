/**
 * Control Plane Monitor — Read-only API server.
 *
 * Serves JSON endpoints for the monitor UI. All endpoints are read-only.
 * The server opens the execution DB in read-only mode and exposes
 * projected views from the law stores.
 */

import express from 'express';
import path from 'path';
import { openDb } from '../db/connection.js';
import { migrateHandoffSchema } from '../handoff/store/handoff-sql.js';
import { HandoffStore } from '../handoff/store/handoff-store.js';
import { QueueStore } from '../handoff/queue/queue-store.js';
import { SupervisorStore } from '../handoff/supervisor/supervisor-store.js';
import { RoutingStore } from '../handoff/routing/routing-store.js';
import { FlowStore } from '../handoff/flow/flow-store.js';
import { InterventionStore } from '../handoff/intervention/intervention-store.js';
import { PolicyStore } from '../handoff/policy/policy-store.js';
import { OutcomeStore } from '../handoff/outcome/outcome-store.js';
import { CalibrationStore } from '../handoff/calibration/calibration-store.js';
import { PromotionStore } from '../handoff/promotion/promotion-store.js';
import { queryOverview } from './queries/overview-query.js';
import { queryQueueList } from './queries/queue-query.js';
import { queryItemDetail } from './queries/item-detail-query.js';
import { queryLaneHealth, queryAllLaneHealth } from './queries/lane-health-query.js';
import { queryActivity } from './queries/activity-query.js';
import type { RoutingLane } from '../handoff/routing/types.js';
import { ALL_LANES } from '../handoff/routing/types.js';
import { executeClaimItem } from './commands/claim-item.js';
import { executeReleaseItem } from './commands/release-item.js';
import { executeDeferItem } from './commands/defer-item.js';
import { executeRequeueItem } from './commands/requeue-item.js';
import { executeEscalateItem } from './commands/escalate-item.js';
import { executeDecision } from './commands/decide-item.js';
import type {
  ClaimItemRequest, ReleaseItemRequest, DeferItemRequest,
  RequeueItemRequest, EscalateItemRequest, DecisionRequest,
} from './types.js';

export interface MonitorServerOptions {
  dbPath: string;
  port: number;
  staticDir?: string;
}

function openStores(dbPath: string) {
  const db = openDb(dbPath);
  migrateHandoffSchema(db);

  const handoffStore = new HandoffStore(db);
  handoffStore.migrate();
  const queueStore = new QueueStore(db);
  queueStore.migrate();
  const supervisorStore = new SupervisorStore(db);
  supervisorStore.migrate();
  const routingStore = new RoutingStore(db);
  routingStore.migrate();
  const flowStore = new FlowStore(db);
  flowStore.migrate();
  const interventionStore = new InterventionStore(db);
  interventionStore.migrate();
  const policyStore = new PolicyStore(db);
  policyStore.migrate();
  const outcomeStore = new OutcomeStore(db);
  outcomeStore.migrate();
  const calibrationStore = new CalibrationStore(db);
  calibrationStore.migrate();
  const promotionStore = new PromotionStore(db);
  promotionStore.migrate();

  return {
    db, handoffStore, queueStore, supervisorStore, routingStore,
    flowStore, interventionStore, policyStore, outcomeStore,
    calibrationStore, promotionStore,
  };
}

export function createMonitorServer(opts: MonitorServerOptions): express.Express {
  const stores = openStores(opts.dbPath);
  const app = express();

  // JSON body parsing for command endpoints
  app.use(express.json());

  // CORS for local development
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
  });

  // ── API routes ──────────────────────────────────────────────────

  // Overview
  app.get('/api/overview', (_req, res) => {
    try {
      const snapshot = queryOverview(stores);
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Queue list
  app.get('/api/queue', (req, res) => {
    try {
      const filters = {
        lane: req.query.lane as RoutingLane | undefined,
        status: req.query.status as string | undefined,
        claimed: req.query.claimed !== undefined
          ? req.query.claimed === 'true'
          : undefined,
        hasOutcome: req.query.hasOutcome !== undefined
          ? req.query.hasOutcome === 'true'
          : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      };
      const items = queryQueueList(stores, filters);
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Item detail
  app.get('/api/items/:queueItemId', (req, res) => {
    try {
      const detail = queryItemDetail(stores, req.params.queueItemId!);
      if (!detail) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }
      res.json(detail);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Lane health — all lanes
  app.get('/api/lanes', (_req, res) => {
    try {
      const lanes = queryAllLaneHealth(stores);
      res.json(lanes);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Lane health — single lane
  app.get('/api/lanes/:lane', (req, res) => {
    try {
      const lane = req.params.lane as RoutingLane;
      if (!ALL_LANES.includes(lane)) {
        res.status(400).json({ error: `Invalid lane: ${lane}` });
        return;
      }
      const health = queryLaneHealth(stores, lane);
      res.json(health);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Activity timeline
  app.get('/api/activity', (req, res) => {
    try {
      const filters = {
        source: req.query.source as string | undefined,
        lane: req.query.lane as RoutingLane | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        since: req.query.since as string | undefined,
      };
      const events = queryActivity(stores, filters as Parameters<typeof queryActivity>[1]);
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Command routes (operator intents) ──────────────────────────

  // Claim
  app.post('/api/monitor/queue/:queueItemId/claim', (req, res) => {
    try {
      const body = req.body as ClaimItemRequest;
      if (!body?.operatorId) {
        res.status(400).json({ ok: false, error: { code: 'missing_field', message: 'operatorId is required' } });
        return;
      }
      const result = executeClaimItem(stores.queueStore, stores.supervisorStore, req.params.queueItemId!, body);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: 'internal', message: String(err) } });
    }
  });

  // Release
  app.post('/api/monitor/queue/:queueItemId/release', (req, res) => {
    try {
      const body = req.body as ReleaseItemRequest;
      if (!body?.operatorId) {
        res.status(400).json({ ok: false, error: { code: 'missing_field', message: 'operatorId is required' } });
        return;
      }
      const result = executeReleaseItem(stores.queueStore, stores.supervisorStore, req.params.queueItemId!, body);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: 'internal', message: String(err) } });
    }
  });

  // Defer
  app.post('/api/monitor/queue/:queueItemId/defer', (req, res) => {
    try {
      const body = req.body as DeferItemRequest;
      if (!body?.operatorId || !body?.reason) {
        res.status(400).json({ ok: false, error: { code: 'missing_field', message: 'operatorId and reason are required' } });
        return;
      }
      const result = executeDeferItem(stores.supervisorStore, req.params.queueItemId!, body);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: 'internal', message: String(err) } });
    }
  });

  // Requeue
  app.post('/api/monitor/queue/:queueItemId/requeue', (req, res) => {
    try {
      const body = req.body as RequeueItemRequest;
      if (!body?.operatorId) {
        res.status(400).json({ ok: false, error: { code: 'missing_field', message: 'operatorId is required' } });
        return;
      }
      const result = executeRequeueItem(stores.queueStore, stores.supervisorStore, req.params.queueItemId!, body);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: 'internal', message: String(err) } });
    }
  });

  // Escalate
  app.post('/api/monitor/queue/:queueItemId/escalate', (req, res) => {
    try {
      const body = req.body as EscalateItemRequest;
      if (!body?.operatorId || !body?.reason) {
        res.status(400).json({ ok: false, error: { code: 'missing_field', message: 'operatorId and reason are required' } });
        return;
      }
      const result = executeEscalateItem(stores.supervisorStore, req.params.queueItemId!, body);
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: 'internal', message: String(err) } });
    }
  });

  // Decide (Phase 13C)
  app.post('/api/monitor/queue/:queueItemId/decide', (req, res) => {
    try {
      const body = req.body as DecisionRequest;
      if (!body?.operatorId || !body?.action || !body?.reason) {
        res.status(400).json({ ok: false, error: { code: 'missing_field', message: 'operatorId, action, and reason are required' } });
        return;
      }
      const result = executeDecision(
        stores.handoffStore, stores.queueStore, stores.supervisorStore,
        req.params.queueItemId!, body,
      );
      res.status(result.ok ? 200 : 409).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: 'internal', message: String(err) } });
    }
  });

  // ── Static files (for production build) ─────────────────────────

  if (opts.staticDir) {
    app.use(express.static(opts.staticDir));
    // SPA fallback
    app.get('*', (_req, res) => {
      res.sendFile(path.join(opts.staticDir!, 'index.html'));
    });
  }

  return app;
}

export function startMonitorServer(opts: MonitorServerOptions): void {
  const app = createMonitorServer(opts);
  app.listen(opts.port, () => {
    console.log(`Control Plane Monitor running at http://localhost:${opts.port}`);
    console.log(`  DB: ${opts.dbPath}`);
    console.log(`  API: http://localhost:${opts.port}/api/overview`);
    if (opts.staticDir) {
      console.log(`  UI: http://localhost:${opts.port}`);
    }
  });
}
