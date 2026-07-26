import { z } from 'zod';

import { issueAccessToken } from './token';

const config = z.object({
  AUTH_TOKEN_SECRET: z.string().min(32),
  ACTOR_ID: z.string().uuid(),
  WORKSPACE_ID: z.string().uuid(),
  WORKSPACE_ROLE: z.enum(['owner', 'admin', 'editor', 'approver', 'viewer']),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3_600),
}).parse(process.env);

const token = issueAccessToken({
  actorId: config.ACTOR_ID,
  workspaceId: config.WORKSPACE_ID,
  role: config.WORKSPACE_ROLE,
  exp: Math.floor(Date.now() / 1000) + config.ACCESS_TOKEN_TTL_SECONDS,
}, config.AUTH_TOKEN_SECRET);

process.stdout.write(`${token}\n`);
