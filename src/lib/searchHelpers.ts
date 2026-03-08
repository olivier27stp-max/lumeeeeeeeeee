import { SearchEntityType } from './globalSearchApi';

export function getSearchEntityLabel(type: SearchEntityType) {
  if (type === 'client') return 'Clients';
  if (type === 'job') return 'Jobs';
  return 'Leads';
}

export function getSearchItemHref(type: SearchEntityType, id: string) {
  if (type === 'client') return `/clients/${id}`;
  if (type === 'job') return `/jobs/${id}`;
  return `/pipeline?leadId=${id}`;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
