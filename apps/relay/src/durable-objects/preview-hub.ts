import { DurableObject } from 'cloudflare:workers';
import type { RelayBindings } from '../env.js';

export class PreviewHub extends DurableObject<RelayBindings> {}
