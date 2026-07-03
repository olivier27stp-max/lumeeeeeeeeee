// Single source of truth for the premium status badge lives in ./StatusBadge.
// This module is kept for the kebab-case import path and the ClientStatus type.
export { default } from './StatusBadge';

export type ClientStatus = 'lead' | 'active' | 'inactive';
