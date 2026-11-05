/** Express guard for the paid (full AI edit) routes. The plan is resolved on the server, never from the request. */

import type {RequestHandler} from 'express';

import {assertFullEditEntitlement} from '../lib/entitlement.ts';
import {getAuth} from './auth.ts';

export const requireFullEdit: RequestHandler = async (_req, res, next) => {
  try {
    await assertFullEditEntitlement(getAuth(res));
    next();
  } catch (error) {
    next(error);
  }
};
